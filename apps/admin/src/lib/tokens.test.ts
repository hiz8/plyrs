import { describe, expect, it } from "vitest";
import type { GrantSummary, TokenSummary } from "./admin-api";
import {
  canManageTokens,
  connectionRows,
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
  it("管理者には record:publish を含む 6 つ、既定は record:read と record:propose", () => {
    expect(scopeOptionsFor("owner").map((o) => o.value)).toEqual([
      "record:read",
      "record:propose",
      "record:write",
      "record:delete",
      "record:publish",
      "type:manage",
    ]);
    // M5c の申し送り(2026-11-08、所有者の判断): record:write は record:propose を内包しない。
    // その代わり、新しく発行するトークンには既定で提案を持たせる
    expect(DEFAULT_SCOPES).toEqual(["record:read", "record:propose"]);
    for (const option of scopeOptionsFor("owner")) {
      expect(option.label).toBeTruthy();
      expect(option.description).toBeTruthy();
    }
  });

  it("管理者以外には record:publish を出さない(編集者はロールの範囲、閲覧者は読み取りだけ)", () => {
    expect(scopeOptionsFor("editor").map((o) => o.value)).toEqual([
      "record:read",
      "record:propose",
      "record:write",
      "record:delete",
    ]);
    expect(scopeOptionsFor("viewer").map((o) => o.value)).toEqual(["record:read"]);
  });
});

describe("期限の選択肢", () => {
  it("読み取りだけなら 30 / 90 / 365 日で既定 90、書き込み付きなら 7 / 30 / 90 日で既定 30", () => {
    expect(isReadOnlyScopes(["record:read"])).toBe(true);
    // M5c: 提案はデータを作るので書き込み扱い(期限は 90 日まで)
    expect(isReadOnlyScopes(["record:read", "record:propose"])).toBe(false);
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

describe("接続中のアプリの行(M3-5)", () => {
  function grant(overrides: Partial<GrantSummary> = {}): GrantSummary {
    return {
      id: "g1",
      userId: "u2",
      email: "editor@example.com",
      clientId: "https://claude.ai/.well-known/oauth-client",
      clientName: "Claude",
      scopes: ["record:read"],
      createdAt: "2026-10-15T00:00:00Z",
      expiresAt: null,
      pending: false,
      ...overrides,
    };
  }

  it("PAT の行の後に OAuth の行を createdAt 順に並べ、名前はクライアント名(無ければ client_id)", () => {
    const rows = connectionRows(
      [token()],
      [
        grant({ id: "g2", createdAt: "2026-10-20T00:00:00Z", clientName: null }),
        grant({ id: "g1", createdAt: "2026-10-10T00:00:00Z" }),
      ],
      NOW,
    );
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual([
      "pat:pat:tok1",
      "oauth:oauth:g1",
      "oauth:oauth:g2",
    ]);
    expect(rows[0]).toMatchObject({ name: "Claude Code", email: null, canRevoke: true });
    expect(rows[1]).toMatchObject({
      name: "Claude",
      email: "editor@example.com",
      expiryText: "期限なし",
      lastUsedText: "—",
      canRevoke: true,
      status: "active",
    });
    expect(rows[2]?.name).toBe("https://claude.ai/.well-known/oauth-client");
  });

  it("OAuth の行の期限は残り日数、過ぎていれば期限切れ(それでも失効できる)", () => {
    const rows = connectionRows(
      [],
      [
        grant({ id: "g1", expiresAt: "2026-11-11T00:00:00Z" }),
        grant({ id: "g2", expiresAt: "2026-10-01T00:00:00Z" }),
      ],
      NOW,
    );
    expect(rows[0]?.expiryText).toContain("10");
    expect(rows[1]).toMatchObject({ status: "expired", expiryText: "期限切れ", canRevoke: true });
  });

  it("認可コードを交換していない付与は「接続待ち」と出し、失効できる(M3 の見送り指摘 (h))", () => {
    const rows = connectionRows([], [grant({ id: "g1", pending: true })], NOW);
    expect(rows[0]).toMatchObject({ expiryText: "接続待ち", canRevoke: true });
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
