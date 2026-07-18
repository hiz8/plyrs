import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { auditLogs, memberships, users } from "@plyrs/db/control-plane";
import { isBlocked, isMembershipBlocked } from "../src/auth/blocklist";
import { app } from "../src/index";
import { insertTenantWithOwner } from "./create-tenant";
import { resetSuperAdmins, superEnv, superLogin } from "./super-login";

afterEach(resetSuperAdmins);

function jsonReq(method: string, path: string, cookie: string, body?: unknown): Request {
  return new Request(`https://api.test${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function insertUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await drizzle(env.DB)
    .insert(users)
    .values({ id, email, passwordHash: "h", createdAt: new Date().toISOString() });
  return id;
}

async function actions(): Promise<string[]> {
  return (await drizzle(env.DB).select({ action: auditLogs.action }).from(auditLogs)).map(
    (r) => r.action,
  );
}

describe("super user management", () => {
  it("requires the super session", async () => {
    expect((await app.request("/super/v1/users", {}, superEnv())).status).toBe(401);
  });

  it("searches users by email fragment with accurate membership counts", async () => {
    const { cookie } = await superLogin();
    const e = superEnv();
    const tag = crypto.randomUUID();
    const aliceEmail = `aaa-${tag}@x.com`;
    const zebraEmail = `zzz-${tag}@x.com`;
    const bobEmail = `bob-${crypto.randomUUID()}@other.com`;
    const aliceId = await insertUser(aliceEmail);
    const zebraId = await insertUser(zebraEmail);
    await insertUser(bobEmail);

    await insertTenantWithOwner(aliceId, { slug: `su-${crypto.randomUUID()}` });
    await drizzle(env.DB).insert(memberships).values({
      userId: aliceId,
      tenantId: crypto.randomUUID(),
      role: "viewer",
      createdAt: new Date().toISOString(),
    });
    await insertTenantWithOwner(zebraId, { slug: `su-${crypto.randomUUID()}` });

    const res = await app.request(`/super/v1/users?q=${tag}`, { headers: { cookie } }, e);
    expect(res.status).toBe(200);
    const { users: rows } = (await res.json()) as {
      users: { id: string; email: string; createdAt: string; membershipCount: number }[];
    };
    // bob は q に一致しないので除外され、email 昇順で alice → zebra の 2 件のみ
    expect(rows).toMatchObject([
      { id: aliceId, email: aliceEmail, membershipCount: 2 },
      { id: zebraId, email: zebraEmail, membershipCount: 1 },
    ]);
  });

  it("bans and unbans a user", async () => {
    const { cookie } = await superLogin();
    const e = superEnv();
    const userId = await insertUser(`banme-${crypto.randomUUID()}@x.com`);

    const banRes = await app.request(
      jsonReq("POST", `/super/v1/users/${userId}/ban`, cookie),
      undefined,
      e,
    );
    expect(banRes.status).toBe(200);
    expect(await banRes.json()).toEqual({ ok: true, disconnected: 0 });
    expect(await isBlocked(env.BLOCKLIST, userId)).toBe(true);
    expect(await actions()).toContain("user.ban");

    const unbanRes = await app.request(
      jsonReq("POST", `/super/v1/users/${userId}/unban`, cookie),
      undefined,
      e,
    );
    expect(unbanRes.status).toBe(200);
    expect(await unbanRes.json()).toEqual({ ok: true });
    expect(await isBlocked(env.BLOCKLIST, userId)).toBe(false);
    expect(await actions()).toContain("user.unban");
  });

  it("lists members and revokes a membership", async () => {
    const { cookie } = await superLogin();
    const e = superEnv();
    const email = `member-${crypto.randomUUID()}@x.com`;
    const userId = await insertUser(email);
    const { tenantId } = await insertTenantWithOwner(userId, { slug: `su-${crypto.randomUUID()}` });

    const listRes = await app.request(
      `/super/v1/tenants/${tenantId}/members`,
      { headers: { cookie } },
      e,
    );
    expect(listRes.status).toBe(200);
    const { members } = (await listRes.json()) as {
      members: { userId: string; email: string; role: string; createdAt: string }[];
    };
    expect(members).toMatchObject([{ userId, email, role: "owner" }]);

    const delRes = await app.request(
      jsonReq("DELETE", `/super/v1/tenants/${tenantId}/members/${userId}`, cookie),
      undefined,
      e,
    );
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ ok: true, disconnected: 0 });
    expect(
      await drizzle(env.DB).select().from(memberships).where(eq(memberships.tenantId, tenantId)),
    ).toHaveLength(0);
    expect(await isMembershipBlocked(env.BLOCKLIST, userId, tenantId)).toBe(true);
    expect(await actions()).toContain("membership.revoke");
  });

  it("lists audit logs in createdAt descending order", async () => {
    const { cookie } = await superLogin();
    const e = superEnv();
    const actorId = crypto.randomUUID();
    const targetId = crypto.randomUUID();
    const older = {
      id: crypto.randomUUID(),
      actorId,
      action: "tenant.create",
      targetType: "tenant",
      targetId,
      detail: "{}",
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    const newer = {
      id: crypto.randomUUID(),
      actorId,
      action: "tenant.delete",
      targetType: "tenant",
      targetId,
      detail: "{}",
      createdAt: "2026-07-02T00:00:00.000Z",
    };
    await drizzle(env.DB).insert(auditLogs).values([older, newer]);

    const res = await app.request("/super/v1/audit-logs", { headers: { cookie } }, e);
    expect(res.status).toBe(200);
    const { auditLogs: rows } = (await res.json()) as { auditLogs: { id: string }[] };
    const ids = rows.map((row) => row.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
  });
});
