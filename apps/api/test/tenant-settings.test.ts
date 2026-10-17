import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { auditLogs, memberships, tenants, users } from "@plyrs/db/control-plane";
import { blockMembership, isMembershipBlocked } from "../src/auth/blocklist";
import { signTenantToken } from "../src/auth/jwt";
import type { Role } from "../src/auth/permissions";
import { app } from "../src/index";

// 案 G 3・4 章: テナントの owner によるサイト名の変更とメンバーの管理(T13)

async function insertUser(): Promise<{ id: string; email: string }> {
  const id = crypto.randomUUID();
  const email = `${id}@example.com`;
  await drizzle(env.DB)
    .insert(users)
    .values({ id, email, passwordHash: "h", createdAt: new Date().toISOString() });
  return { id, email };
}

async function addMembership(userId: string, tenantId: string, role: Role): Promise<void> {
  await drizzle(env.DB)
    .insert(memberships)
    .values({ userId, tenantId, role, createdAt: new Date().toISOString() });
}

async function bearer(userId: string, tenantId: string, role: Role): Promise<string> {
  return `Bearer ${await signTenantToken(env.JWT_SECRET, { userId, tenantId, role })}`;
}

// owner 1 人のサイトを用意し、その owner のトークンを返す
async function setupSite(): Promise<{
  tenantId: string;
  owner: { id: string; email: string };
  auth: string;
}> {
  const tenantId = crypto.randomUUID();
  await drizzle(env.DB)
    .insert(tenants)
    .values({
      id: tenantId,
      slug: `s-${tenantId}`,
      name: "Site",
      createdAt: new Date().toISOString(),
    });
  const owner = await insertUser();
  await addMembership(owner.id, tenantId, "owner");
  return { tenantId, owner, auth: await bearer(owner.id, tenantId, "owner") };
}

async function call(method: string, path: string, auth: string, body?: unknown): Promise<Response> {
  return app.request(
    path,
    {
      method,
      headers: { "content-type": "application/json", authorization: auth },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

async function roleOf(userId: string, tenantId: string): Promise<string | undefined> {
  const row = (
    await drizzle(env.DB)
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
  )[0];
  return row?.role;
}

async function auditActions(targetId: string): Promise<string[]> {
  const rows = await drizzle(env.DB)
    .select({ action: auditLogs.action })
    .from(auditLogs)
    .where(eq(auditLogs.targetId, targetId));
  return rows.map((row) => row.action);
}

describe("PATCH /v1/t/:tenantId/site", () => {
  it("renames the site for the owner and records the audit log", async () => {
    const { tenantId, auth } = await setupSite();
    const res = await call("PATCH", `/v1/t/${tenantId}/site`, auth, { name: "  新しい名前 " });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ ok: true, name: "新しい名前" });
    const row = (await drizzle(env.DB).select().from(tenants).where(eq(tenants.id, tenantId)))[0];
    expect(row).toMatchObject({ name: "新しい名前", slug: `s-${tenantId}` });
    expect(await auditActions(tenantId)).toStrictEqual(["site.rename"]);
  });

  it("rejects editors and an empty name", async () => {
    const { tenantId, auth } = await setupSite();
    const editor = await insertUser();
    await addMembership(editor.id, tenantId, "editor");
    const asEditor = await bearer(editor.id, tenantId, "editor");
    expect((await call("PATCH", `/v1/t/${tenantId}/site`, asEditor, { name: "x" })).status).toBe(
      403,
    );
    expect((await call("PATCH", `/v1/t/${tenantId}/site`, auth, { name: "  " })).status).toBe(400);
  });
});

describe("/v1/t/:tenantId/members", () => {
  it("requires a token", async () => {
    const { tenantId } = await setupSite();
    expect((await app.request(`/v1/t/${tenantId}/members`, {}, env)).status).toBe(401);
  });

  it("lists members for the owner only", async () => {
    const { tenantId, owner, auth } = await setupSite();
    const viewer = await insertUser();
    await addMembership(viewer.id, tenantId, "viewer");
    const res = await call("GET", `/v1/t/${tenantId}/members`, auth);
    expect(res.status).toBe(200);
    const { members } = (await res.json()) as {
      members: { userId: string; email: string; role: string }[];
    };
    expect(members.map((m) => [m.email, m.role])).toStrictEqual([
      [owner.email, "owner"],
      [viewer.email, "viewer"],
    ]);
    const asViewer = await bearer(viewer.id, tenantId, "viewer");
    expect((await call("GET", `/v1/t/${tenantId}/members`, asViewer)).status).toBe(403);
  });

  it("re-checks the current role in D1, not only the token", async () => {
    const { tenantId, owner, auth } = await setupSite();
    const other = await insertUser();
    await addMembership(other.id, tenantId, "owner");
    // owner だったトークンを持ったまま editor に下げられた
    await drizzle(env.DB)
      .update(memberships)
      .set({ role: "editor" })
      .where(and(eq(memberships.userId, owner.id), eq(memberships.tenantId, tenantId)));
    expect((await call("GET", `/v1/t/${tenantId}/members`, auth)).status).toBe(403);
  });

  it("adds a registered user by email", async () => {
    const { tenantId, auth } = await setupSite();
    const newcomer = await insertUser();
    const res = await call("POST", `/v1/t/${tenantId}/members`, auth, {
      email: newcomer.email.toUpperCase(),
      role: "editor",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      member: { userId: newcomer.id, email: newcomer.email, role: "editor" },
    });
    expect(await roleOf(newcomer.id, tenantId)).toBe("editor");
    expect(await auditActions(`${newcomer.id}:${tenantId}`)).toStrictEqual(["member.add"]);
  });

  it("rejects unregistered emails and existing members", async () => {
    const { tenantId, owner, auth } = await setupSite();
    const unknown = await call("POST", `/v1/t/${tenantId}/members`, auth, {
      email: `nobody-${crypto.randomUUID()}@example.com`,
      role: "viewer",
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toStrictEqual({ error: "user_not_found" });
    const again = await call("POST", `/v1/t/${tenantId}/members`, auth, {
      email: owner.email,
      role: "viewer",
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toStrictEqual({ error: "already_member" });
    expect(await roleOf(owner.id, tenantId)).toBe("owner");
  });

  it("clears a leftover membership block when re-adding someone", async () => {
    const { tenantId, auth } = await setupSite();
    const returning = await insertUser();
    await blockMembership(env.BLOCKLIST, returning.id, tenantId);
    const res = await call("POST", `/v1/t/${tenantId}/members`, auth, {
      email: returning.email,
      role: "viewer",
    });
    expect(res.status).toBe(201);
    expect(await isMembershipBlocked(env.BLOCKLIST, returning.id, tenantId)).toBe(false);
  });

  it("changes a role and records from/to", async () => {
    const { tenantId, auth } = await setupSite();
    const member = await insertUser();
    await addMembership(member.id, tenantId, "viewer");
    const res = await call("PATCH", `/v1/t/${tenantId}/members/${member.id}`, auth, {
      role: "editor",
    });
    expect(res.status).toBe(200);
    expect(await roleOf(member.id, tenantId)).toBe("editor");
    const detail = (
      await drizzle(env.DB)
        .select({ detail: auditLogs.detail })
        .from(auditLogs)
        .where(eq(auditLogs.targetId, `${member.id}:${tenantId}`))
    )[0];
    expect(JSON.parse(detail?.detail ?? "{}")).toStrictEqual({ from: "viewer", to: "editor" });
    expect(
      (
        await call("PATCH", `/v1/t/${tenantId}/members/${crypto.randomUUID()}`, auth, {
          role: "editor",
        })
      ).status,
    ).toBe(404);
  });

  it("removes a member and blocks their issued tokens immediately", async () => {
    const { tenantId, auth } = await setupSite();
    const member = await insertUser();
    await addMembership(member.id, tenantId, "editor");
    const memberAuth = await bearer(member.id, tenantId, "editor");
    expect((await call("GET", `/v1/t/${tenantId}/content-types`, memberAuth)).status).toBe(200);
    const res = await call("DELETE", `/v1/t/${tenantId}/members/${member.id}`, auth);
    expect(res.status).toBe(200);
    expect(await roleOf(member.id, tenantId)).toBeUndefined();
    expect((await call("GET", `/v1/t/${tenantId}/content-types`, memberAuth)).status).toBe(403);
    expect(await auditActions(`${member.id}:${tenantId}`)).toStrictEqual(["member.remove"]);
    expect((await call("DELETE", `/v1/t/${tenantId}/members/${member.id}`, auth)).status).toBe(404);
  });

  it("never removes or demotes the last owner", async () => {
    const { tenantId, owner, auth } = await setupSite();
    const demote = await call("PATCH", `/v1/t/${tenantId}/members/${owner.id}`, auth, {
      role: "editor",
    });
    expect(demote.status).toBe(409);
    expect(await demote.json()).toStrictEqual({ error: "last_owner" });
    const remove = await call("DELETE", `/v1/t/${tenantId}/members/${owner.id}`, auth);
    expect(remove.status).toBe(409);
    expect(await roleOf(owner.id, tenantId)).toBe("owner");
    expect(await auditActions(`${owner.id}:${tenantId}`)).toStrictEqual([]);
  });

  it("lets an owner step down while another owner remains", async () => {
    const { tenantId, owner, auth } = await setupSite();
    const second = await insertUser();
    await addMembership(second.id, tenantId, "owner");
    const res = await call("PATCH", `/v1/t/${tenantId}/members/${owner.id}`, auth, {
      role: "viewer",
    });
    expect(res.status).toBe(200);
    expect(await roleOf(owner.id, tenantId)).toBe("viewer");
    // 残った 1 人は最後の owner になる
    const asSecond = await bearer(second.id, tenantId, "owner");
    expect((await call("DELETE", `/v1/t/${tenantId}/members/${second.id}`, asSecond)).status).toBe(
      409,
    );
  });
});
