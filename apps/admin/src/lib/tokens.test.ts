import { describe, expect, it } from "vitest";
import type { TokenSummary } from "./admin-api";
import {
  canManageTokens,
  DEFAULT_SCOPES,
  defaultExpiryFor,
  expiryOptionsFor,
  isReadOnlyScopes,
  mcpEndpoint,
  scopeOptionsFor,
  tokenRows,
} from "./tokens";

// M1-4(design-spec 16.3、論点 C5): 接続トークン(PAT)画面の純関数。
// スコープの選択肢と期限は api の auth/pat.ts と同じ規則(読み取りのみ 365 日・書き込み付き 90 日)。

const NOW = new Date("2026-11-01T00:00:00Z");

function token(overrides: Partial<TokenSummary> = {}): TokenSummary {
  return {
    id: "tok1",
    userId: "u1",
    name: "Claude Code",
    scopes: ["record:read"],
    expiresAt: "2026-12-01T00:00:00Z",
    createdAt: "2026-10-01T00:00:00Z",
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("スコープの選択肢", () => {
  it("管理者には record:publish を含む 5 つ、既定は record:read だけ", () => {
    expect(scopeOptionsFor("owner").map((o) => o.value)).toEqual([
      "record:read",
      "record:write",
      "record:delete",
      "record:publish",
      "type:manage",
    ]);
    expect(DEFAULT_SCOPES).toEqual(["record:read"]);
    for (const option of scopeOptionsFor("owner")) {
      expect(option.label).toBeTruthy();
      expect(option.description).toBeTruthy();
    }
  });

  it("管理者以外には record:publish を出さない(編集者はロールの範囲、閲覧者は読み取りだけ)", () => {
    expect(scopeOptionsFor("editor").map((o) => o.value)).toEqual([
      "record:read",
      "record:write",
      "record:delete",
    ]);
    expect(scopeOptionsFor("viewer").map((o) => o.value)).toEqual(["record:read"]);
  });
});

describe("期限の選択肢", () => {
  it("読み取りだけなら 30 / 90 / 365 日で既定 90、書き込み付きなら 7 / 30 / 90 日で既定 30", () => {
    expect(isReadOnlyScopes(["record:read"])).toBe(true);
    expect(isReadOnlyScopes(["record:read", "record:write"])).toBe(false);
    expect(expiryOptionsFor(["record:read"]).map((o) => o.days)).toEqual([30, 90, 365]);
    expect(defaultExpiryFor(["record:read"])).toBe(90);
    expect(expiryOptionsFor(["record:read", "type:manage"]).map((o) => o.days)).toEqual([
      7, 30, 90,
    ]);
    expect(defaultExpiryFor(["record:write"])).toBe(30);
    for (const option of expiryOptionsFor(["record:read"])) {
      expect(option.label).toContain(String(option.days));
    }
  });
});

describe("一覧の行", () => {
  it("有効・期限切れ・失効済みを分け、残り日数と最終利用を文字にする", () => {
    const rows = tokenRows(
      [
        token(),
        token({ id: "tok2", expiresAt: "2026-10-31T00:00:00Z" }),
        token({
          id: "tok3",
          revokedAt: "2026-10-20T00:00:00Z",
          lastUsedAt: "2026-10-19T00:00:00Z",
        }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.status)).toEqual(["active", "expired", "revoked"]);
    expect(rows[0]?.expiryText).toContain("30");
    expect(rows[0]?.lastUsedText).toBe("未使用");
    expect(rows[1]?.expiryText).toBe("期限切れ");
    expect(rows[2]?.lastUsedText).not.toBe("未使用");
    expect(rows[2]?.canRevoke).toBe(false);
    expect(rows[0]?.canRevoke).toBe(true);
    expect(rows[1]?.canRevoke).toBe(false);
  });
});

describe("画面の出し分けと接続先", () => {
  it("管理者だけが接続トークンを扱える", () => {
    expect(canManageTokens("owner")).toBe(true);
    expect(canManageTokens("editor")).toBe(false);
    expect(canManageTokens("viewer")).toBe(false);
    expect(canManageTokens("unknown")).toBe(false);
  });

  it("MCP の接続先は api のオリジン + /mcp/t/<tenantId>", () => {
    expect(mcpEndpoint("https://api.example/", "t1")).toBe("https://api.example/mcp/t/t1");
  });
});
