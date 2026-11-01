import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import { blockMembership, blockUser, unblockMembership, unblockUser } from "../src/auth/blocklist";
import { issuePat, revokePat } from "../src/auth/pat";
import type { Role } from "../src/auth/permissions";
import { authenticateMcpToken, mcpTokenValidator } from "../src/middleware/mcp-gate";

// M1-3b(design-spec 16.3、決定 49): PAT → McpAuth の合流関数。BLOCKLIST の 2 キーを PAT にも適用する。
// M3-3 で OAuth の分岐がここに入る。

const NOW = new Date();

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
    const result = await authenticateMcpToken(env, tenantId, issued.token, NOW);
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
    expect(await authenticateMcpToken(env, tenantId, "eyJhbGciOi.jwt.token", NOW)).toEqual(
      unauthenticated,
    );
    expect(await authenticateMcpToken(env, crypto.randomUUID(), issued.token, NOW)).toEqual(
      unauthenticated,
    );
    expect(
      await authenticateMcpToken(
        env,
        tenantId,
        issued.token,
        new Date(NOW.getTime() + 2 * 86_400_000),
      ),
    ).toEqual(unauthenticated);
    expect(await revokePat(env.DB, tenantId, issued.id, NOW)).toBe(true);
    expect(await authenticateMcpToken(env, tenantId, issued.token, NOW)).toEqual(unauthenticated);
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
      expect(await authenticateMcpToken(env, tenantId, issued.token, NOW)).toEqual(blocked);
    } finally {
      await unblockUser(env.BLOCKLIST, userId);
    }
    await blockMembership(env.BLOCKLIST, userId, tenantId);
    try {
      expect(await authenticateMcpToken(env, tenantId, issued.token, NOW)).toEqual(blocked);
    } finally {
      await unblockMembership(env.BLOCKLIST, userId, tenantId);
    }
    expect((await authenticateMcpToken(env, tenantId, issued.token, NOW)).ok).toBe(true);
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
