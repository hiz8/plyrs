import { OAuthAuthorizationServer } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import { blockMembership, blockUser, unblockMembership, unblockUser } from "../src/auth/blocklist";
import { issuePat, revokePat } from "../src/auth/pat";
import type { Role } from "../src/auth/permissions";
import type { McpAuth } from "../src/do/authorize";
import { authenticateMcpToken, mcpTokenValidator, oauthGrantId } from "../src/middleware/mcp-gate";
import { tenantResource } from "../src/oauth/server";
import { API_ORIGIN, authorize, oauthEnv } from "./oauth-helpers";

// M1-3b(design-spec 16.3、決定 49): PAT → McpAuth の合流関数。BLOCKLIST の 2 キーを PAT にも適用する。
// M3-3: OAuth の access token も同じ McpAuth に合流する(tokenKind "oauth"、tokenId はグラント ID)。

const NOW = new Date();

function resourceOf(tenantId: string): string {
  return tenantResource(API_ORIGIN, tenantId);
}

async function setup(role: Role = "editor"): Promise<{ tenantId: string; userId: string }> {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const now = NOW.toISOString();
  const db = drizzle(env.DB);
  await db
    .insert(tenants)
    .values({ id: tenantId, slug: `s-${tenantId}`, name: "S", createdAt: now });
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@example.com`, passwordHash: "h", createdAt: now });
  await db.insert(memberships).values({ userId, tenantId, role, createdAt: now });
  return { tenantId, userId };
}

describe("authenticateMcpToken", () => {
  it("PAT を McpAuth(userId / role / tenantId / exp / scopes / tokenId / tokenKind)にする", async () => {
    const { tenantId, userId } = await setup("editor");
    const issued = await issuePat(
      env.DB,
      { userId, tenantId, name: "x", scopes: ["record:read", "record:write"], expiresInDays: 7 },
      NOW,
    );
    const result = await authenticateMcpToken(
      env,
      tenantId,
      issued.token,
      resourceOf(tenantId),
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      auth: {
        userId,
        role: "editor",
        tenantId,
        exp: Math.floor(Date.parse(issued.expiresAt) / 1000),
        scopes: ["record:read", "record:write"],
        tokenId: issued.id,
        tokenKind: "pat",
      },
    });
  });

  it("PAT の形でないトークン・別テナントの PAT・期限切れ・失効は unauthenticated(401)", async () => {
    const { tenantId, userId } = await setup();
    const issued = await issuePat(
      env.DB,
      { userId, tenantId, name: "x", scopes: ["record:read"], expiresInDays: 1 },
      NOW,
    );
    const unauthenticated = { ok: false, code: "unauthenticated", status: 401 };
    expect(
      await authenticateMcpToken(env, tenantId, "eyJhbGciOi.jwt.token", resourceOf(tenantId), NOW),
    ).toEqual(unauthenticated);
    expect(
      await authenticateMcpToken(env, crypto.randomUUID(), issued.token, resourceOf(tenantId), NOW),
    ).toEqual(unauthenticated);
    expect(
      await authenticateMcpToken(
        env,
        tenantId,
        issued.token,
        resourceOf(tenantId),
        new Date(NOW.getTime() + 2 * 86_400_000),
      ),
    ).toEqual(unauthenticated);
    expect(await revokePat(env.DB, tenantId, issued.id, NOW)).toBe(true);
    expect(
      await authenticateMcpToken(env, tenantId, issued.token, resourceOf(tenantId), NOW),
    ).toEqual(unauthenticated);
  });

  it("BAN(blocked:user)と membership ブロックは blocked(403)", async () => {
    const { tenantId, userId } = await setup();
    const issued = await issuePat(
      env.DB,
      { userId, tenantId, name: "x", scopes: ["record:read"], expiresInDays: 1 },
      NOW,
    );
    const blocked = { ok: false, code: "blocked", status: 403 };
    await blockUser(env.BLOCKLIST, userId);
    try {
      expect(
        await authenticateMcpToken(env, tenantId, issued.token, resourceOf(tenantId), NOW),
      ).toEqual(blocked);
    } finally {
      await unblockUser(env.BLOCKLIST, userId);
    }
    await blockMembership(env.BLOCKLIST, userId, tenantId);
    try {
      expect(
        await authenticateMcpToken(env, tenantId, issued.token, resourceOf(tenantId), NOW),
      ).toEqual(blocked);
    } finally {
      await unblockMembership(env.BLOCKLIST, userId, tenantId);
    }
    expect(
      (await authenticateMcpToken(env, tenantId, issued.token, resourceOf(tenantId), NOW)).ok,
    ).toBe(true);
  });
});

describe("mcpTokenValidator(OAuthResourceServer の validateToken 用)", () => {
  it("PAT を検証結果に変換し、不正は null、BAN は OAuthError(403)", async () => {
    const { tenantId, userId } = await setup("viewer");
    const issued = await issuePat(
      env.DB,
      { userId, tenantId, name: "x", scopes: ["record:read"], expiresInDays: 1 },
      NOW,
    );
    const resource = `https://api.example/mcp/t/${tenantId}`;
    const validate = mcpTokenValidator(tenantId)(env);
    expect(await validate(resource, issued.token)).toMatchObject({
      props: { userId, tenantId, role: "viewer", tokenId: issued.id, tokenKind: "pat" },
      audience: resource,
      scope: ["record:read"],
      userId,
    });
    expect(await validate(resource, "plyrs_pat_nope")).toBeNull();
    await blockUser(env.BLOCKLIST, userId);
    try {
      await expect(validate(resource, issued.token)).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      await unblockUser(env.BLOCKLIST, userId);
    }
  });
});

describe("authenticateMcpToken(OAuth、M3-3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("OAuth の access token を McpAuth(tokenKind oauth、tokenId はグラント ID)にする", async () => {
    const { tenantId, userId } = await setup("editor");
    const issued = await authorize(tenantId, ["record:read", "record:write"], {
      userId,
      role: "editor",
    });
    const result = await authenticateMcpToken(
      oauthEnv(),
      tenantId,
      issued.access_token,
      resourceOf(tenantId),
      NOW,
    );
    expect(result.ok).toBe(true);
    const auth = (result as { ok: true; auth: McpAuth }).auth;
    expect(auth).toMatchObject({
      userId,
      role: "editor",
      tenantId,
      scopes: ["record:read", "record:write"],
      tokenKind: "oauth",
    });
    expect(auth.tokenId).toBe(issued.access_token.split(":")[1]);
    expect(auth.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("plyrs_pat_ で始まる文字列は OAuth の validateToken に渡さない(Review Focus 5)", async () => {
    const { tenantId, userId } = await setup("editor");
    const issued = await issuePat(
      env.DB,
      { userId, tenantId, name: "x", scopes: ["record:read"], expiresInDays: 1 },
      NOW,
    );
    const spy = vi.spyOn(OAuthAuthorizationServer.prototype, "validateToken");
    const pat = await authenticateMcpToken(
      oauthEnv(),
      tenantId,
      issued.token,
      resourceOf(tenantId),
      NOW,
    );
    expect(pat.ok).toBe(true);
    const nope = await authenticateMcpToken(
      oauthEnv(),
      tenantId,
      "plyrs_pat_nope",
      resourceOf(tenantId),
      NOW,
    );
    expect(nope).toEqual({ ok: false, code: "unauthenticated", status: 401 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("別テナントの resource / 別テナントの入口では 401(Review Focus 1)。ADMIN_ORIGIN 未設定も 401", async () => {
    const { tenantId, userId } = await setup("editor");
    const other = await setup("editor");
    const issued = await authorize(tenantId, ["record:read"], { userId, role: "editor" });
    const unauthenticated = { ok: false, code: "unauthenticated", status: 401 };
    expect(
      await authenticateMcpToken(
        oauthEnv(),
        other.tenantId,
        issued.access_token,
        resourceOf(other.tenantId),
        NOW,
      ),
    ).toEqual(unauthenticated);
    expect(
      await authenticateMcpToken(
        oauthEnv(),
        tenantId,
        issued.access_token,
        resourceOf(other.tenantId),
        NOW,
      ),
    ).toEqual(unauthenticated);
    expect(
      await authenticateMcpToken(
        oauthEnv({ ADMIN_ORIGIN: undefined }),
        tenantId,
        issued.access_token,
        resourceOf(tenantId),
        NOW,
      ),
    ).toEqual(unauthenticated);
  });

  it("BAN(blocked:user)と membership ブロックは OAuth でも blocked(403)", async () => {
    const { tenantId, userId } = await setup("editor");
    const issued = await authorize(tenantId, ["record:read"], { userId, role: "editor" });
    const blocked = { ok: false, code: "blocked", status: 403 };
    const run = () =>
      authenticateMcpToken(oauthEnv(), tenantId, issued.access_token, resourceOf(tenantId), NOW);
    await blockUser(env.BLOCKLIST, userId);
    try {
      expect(await run()).toEqual(blocked);
    } finally {
      await unblockUser(env.BLOCKLIST, userId);
    }
    await blockMembership(env.BLOCKLIST, userId, tenantId);
    try {
      expect(await run()).toEqual(blocked);
    } finally {
      await unblockMembership(env.BLOCKLIST, userId, tenantId);
    }
    expect((await run()).ok).toBe(true);
  });

  it("oauthGrantId は userId:grantId:secret の 2 要素目。利用者が違えば null", () => {
    expect(oauthGrantId("u1:g1:secret", "u1")).toBe("g1");
    expect(oauthGrantId("u2:g1:secret", "u1")).toBeNull();
    expect(oauthGrantId("u1:g1", "u1")).toBeNull();
    expect(oauthGrantId("u1::secret", "u1")).toBeNull();
  });
});
