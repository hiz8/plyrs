import { describe, expect, it, vi } from "vitest";
import { createTokenManager } from "./token-manager";

describe("token manager (2026-07-16 裁定: メモリのみ + 先回りリフレッシュ)", () => {
  it("caches a token while it is outside the refresh margin", async () => {
    let now = 1_000_000;
    const issueToken = vi.fn().mockResolvedValue({ token: "t1", expiresIn: 900 });
    const manager = createTokenManager({ issueToken, now: () => now });
    expect(await manager.getToken("tenant-a")).toBe("t1");
    now += 800_000; // 残 100 秒 > 60 秒マージン
    expect(await manager.getToken("tenant-a")).toBe("t1");
    expect(issueToken).toHaveBeenCalledTimes(1);
  });

  it("refreshes proactively inside the 60s margin (Phase 4b 申し送り: exp 前の先回り)", async () => {
    let now = 0;
    const issueToken = vi
      .fn()
      .mockResolvedValueOnce({ token: "t1", expiresIn: 900 })
      .mockResolvedValueOnce({ token: "t2", expiresIn: 900 });
    const manager = createTokenManager({ issueToken, now: () => now });
    expect(await manager.getToken("a")).toBe("t1");
    now = 841_000; // 残 59 秒 < 60 秒マージン
    expect(await manager.getToken("a")).toBe("t2");
    expect(issueToken).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent refreshes per tenant", async () => {
    const issueToken = vi.fn().mockResolvedValue({ token: "t", expiresIn: 900 });
    const manager = createTokenManager({ issueToken, now: () => 0 });
    const [a, b] = await Promise.all([manager.getToken("a"), manager.getToken("a")]);
    expect(a).toBe("t");
    expect(b).toBe("t");
    expect(issueToken).toHaveBeenCalledTimes(1);
  });

  it("keeps tokens per tenant and clear() drops them all", async () => {
    const issueToken = vi
      .fn()
      .mockImplementation((tenantId: string) =>
        Promise.resolve({ token: `t-${tenantId}`, expiresIn: 900 }),
      );
    const manager = createTokenManager({ issueToken, now: () => 0 });
    expect(await manager.getToken("a")).toBe("t-a");
    expect(await manager.getToken("b")).toBe("t-b");
    manager.clear();
    await manager.getToken("a");
    expect(issueToken).toHaveBeenCalledTimes(3);
  });

  it("does not cache failures", async () => {
    const issueToken = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ token: "t", expiresIn: 900 });
    const manager = createTokenManager({ issueToken, now: () => 0 });
    await expect(manager.getToken("a")).rejects.toThrow("boom");
    expect(await manager.getToken("a")).toBe("t");
  });

  it("forceRefresh bypasses a fresh cache entry", async () => {
    let calls = 0;
    const tokens = createTokenManager({
      issueToken: async () => {
        calls += 1;
        return { token: `t${calls}`, expiresIn: 900 };
      },
    });
    expect(await tokens.getToken("t1")).toBe("t1");
    expect(await tokens.getToken("t1")).toBe("t1"); // キャッシュヒット
    expect(await tokens.getToken("t1", { forceRefresh: true })).toBe("t2");
    expect(calls).toBe(2);
    // forceRefresh 後はキャッシュも更新されている
    expect(await tokens.getToken("t1")).toBe("t2");
  });

  it("forceRefresh reuses an inflight request instead of stacking a second one", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const tokens = createTokenManager({
      issueToken: () =>
        new Promise((resolve) => {
          calls += 1;
          release = () => resolve({ token: `t${calls}`, expiresIn: 900 });
        }),
    });
    const first = tokens.getToken("t1");
    const second = tokens.getToken("t1", { forceRefresh: true });
    release?.();
    expect(await first).toBe("t1");
    expect(await second).toBe("t1");
    expect(calls).toBe(1);
  });

  it("does not repopulate the cache when clear() races an in-flight issue", async () => {
    let resolveIssue: ((value: { token: string; expiresIn: number }) => void) | undefined;
    const issueToken = vi.fn(
      () =>
        new Promise<{ token: string; expiresIn: number }>((resolve) => {
          resolveIssue = resolve;
        }),
    );
    const manager = createTokenManager({ issueToken, now: () => 0 });
    const pending = manager.getToken("a");
    manager.clear(); // ログアウトが飛行中の発行と競合
    resolveIssue?.({ token: "stale-user-token", expiresIn: 900 });
    await pending;
    // clear 後の解決はキャッシュへ書き戻されない → 次の getToken は再発行
    // (issueToken への発行呼び出しは getToken 内の同期プレフィックスで即座に走るため、
    //  再発行分の未解決 Promise を待つ必要はない — ここでは呼び出し回数のみ検証する)
    const reissued = manager.getToken("a");
    expect(issueToken).toHaveBeenCalledTimes(2);
    // 浮いた未解決 Promise を残さない（テスト出力の清潔さ）: 2 回目の発行も解決して回収する
    resolveIssue?.({ token: "fresh-token", expiresIn: 900 });
    expect(await reissued).toBe("fresh-token");
  });
});
