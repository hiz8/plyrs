import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import { banUserEverywhere, revokeMembership } from "../src/auth/ban";
import { blockMembership, isBlocked, isMembershipBlocked } from "../src/auth/blocklist";
import { signTenantToken } from "../src/auth/jwt";
import { authenticateTenantToken } from "../src/middleware/tenant-gate";
import { deleteTenantCascade } from "../src/ops/tenant-delete";

describe("two-tier blocklist", () => {
  it("blocks the gate for a (userId, tenantId) membership block only on that tenant", async () => {
    const userId = crypto.randomUUID();
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();
    const tokenA = await signTenantToken(env.JWT_SECRET, {
      userId,
      tenantId: tenantA,
      role: "editor",
    });
    const tokenB = await signTenantToken(env.JWT_SECRET, {
      userId,
      tenantId: tenantB,
      role: "editor",
    });
    await blockMembership(env.BLOCKLIST, userId, tenantA);
    const resultA = await authenticateTenantToken(env, tenantA, tokenA);
    expect(resultA).toMatchObject({ ok: false, failure: { code: "blocked", status: 403 } });
    const resultB = await authenticateTenantToken(env, tenantB, tokenB);
    expect(resultB.ok).toBe(true);
  });

  it("banUserEverywhere sets the global block and touches every membership tenant", async () => {
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = drizzle(env.DB);
    await db
      .insert(users)
      .values({ id: userId, email: `${userId}@x.com`, passwordHash: "h", createdAt: now });
    await db.insert(memberships).values([
      { userId, tenantId: crypto.randomUUID(), role: "editor", createdAt: now },
      { userId, tenantId: crypto.randomUUID(), role: "viewer", createdAt: now },
    ]);
    const { disconnected } = await banUserEverywhere(env, userId);
    expect(await isBlocked(env.BLOCKLIST, userId)).toBe(true);
    expect(disconnected).toBe(0); // ソケット未確立でも DO 呼び出し自体が成立する
  });

  it("revokeMembership deletes the row and blocks the pair", async () => {
    const userId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const db = drizzle(env.DB);
    await db
      .insert(memberships)
      .values({ userId, tenantId, role: "editor", createdAt: new Date().toISOString() });
    await revokeMembership(env, userId, tenantId);
    expect(await db.select().from(memberships).where(eq(memberships.userId, userId))).toHaveLength(
      0,
    );
    expect(await isMembershipBlocked(env.BLOCKLIST, userId, tenantId)).toBe(true);
  });

  // 最終ブランチレビュー(修正2): テナント削除前に発行済みの JWT は、削除後も exp まで
  // 有効な「粗い身分証」のままなので、blockMembership で復活ウィンドウを封鎖する。
  it("deleteTenantCascade blocks a former member's still-valid JWT", async () => {
    const userId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const slug = `del-${tenantId}`;
    const now = new Date().toISOString();
    const db = drizzle(env.DB);
    await db.insert(tenants).values({ id: tenantId, slug, name: "T", createdAt: now });
    await db.insert(memberships).values({ userId, tenantId, role: "owner", createdAt: now });
    const token = await signTenantToken(env.JWT_SECRET, { userId, tenantId, role: "owner" });

    const before = await authenticateTenantToken(env, tenantId, token);
    expect(before.ok).toBe(true);

    await deleteTenantCascade(env, { id: tenantId, slug });

    const after = await authenticateTenantToken(env, tenantId, token);
    expect(after).toMatchObject({ ok: false, failure: { code: "blocked", status: 403 } });
  });
});
