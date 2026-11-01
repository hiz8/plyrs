import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { auditLogs, memberships, tenants, users } from "@plyrs/db/control-plane";
import { signTenantToken } from "../src/auth/jwt";
import { banUserEverywhere } from "../src/auth/ban";
import {
  allowedScopes,
  disallowedScopes,
  issuePat,
  maxExpiryDays,
  verifyPat,
} from "../src/auth/pat";
import type { Role } from "../src/auth/permissions";
import { app } from "../src/index";

// M1-3a(design-spec 16.3): PAT の表と発行・失効 API。raw token は発行応答の 1 回だけで D1 には
// ハッシュしか残らない(Review Focus 2)。発行できるのは所有者だけ、record:publish も所有者だけ。

async function insertUser(): Promise<string> {
  const id = crypto.randomUUID();
  await drizzle(env.DB)
    .insert(users)
    .values({
      id,
      email: `${id}@example.com`,
      passwordHash: "h",
      createdAt: new Date().toISOString(),
    });
  return id;
}

async function setupSite(): Promise<{ tenantId: string; ownerId: string; editorId: string }> {
  const tenantId = crypto.randomUUID();
  const now = new Date().toISOString();
  await drizzle(env.DB)
    .insert(tenants)
    .values({ id: tenantId, slug: `s-${tenantId}`, name: "Site", createdAt: now });
  const ownerId = await insertUser();
  const editorId = await insertUser();
  await drizzle(env.DB)
    .insert(memberships)
    .values([
      { userId: ownerId, tenantId, role: "owner", createdAt: now },
      { userId: editorId, tenantId, role: "editor", createdAt: now },
    ]);
  return { tenantId, ownerId, editorId };
}

async function bearer(userId: string, tenantId: string, role: Role): Promise<string> {
  return `Bearer ${await signTenantToken(env.JWT_SECRET, { userId, tenantId, role })}`;
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

function daysFromNow(iso: string): number {
  return Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
}

interface Issued {
  id: string;
  token: string;
  expiresAt: string;
}

describe("純関数", () => {
  it("allowedScopes: record:publish と type:manage は所有者だけ", () => {
    expect(allowedScopes("owner")).toEqual([
      "record:read",
      "record:write",
      "record:delete",
      "record:publish",
      "type:manage",
    ]);
    expect(allowedScopes("editor")).toEqual(["record:read", "record:write", "record:delete"]);
    expect(allowedScopes("viewer")).toEqual(["record:read"]);
  });

  it("disallowedScopes: ロールに許されないスコープだけを返す(発行ルートが 400 にする)", () => {
    expect(disallowedScopes("owner", ["record:read", "record:publish", "type:manage"])).toEqual([]);
    expect(disallowedScopes("editor", ["record:read", "record:publish", "type:manage"])).toEqual([
      "record:publish",
      "type:manage",
    ]);
    expect(disallowedScopes("viewer", ["record:write"])).toEqual(["record:write"]);
  });

  it("maxExpiryDays: 読み取りのみは 365 日、書き込みスコープを含めば 90 日", () => {
    expect(maxExpiryDays(["record:read"])).toBe(365);
    expect(maxExpiryDays(["record:read", "record:write"])).toBe(90);
    expect(maxExpiryDays(["record:publish"])).toBe(90);
  });
});

describe("POST /v1/t/:tenantId/tokens", () => {
  it("所有者が発行でき、応答にだけ token があり D1 のどの列にも raw は無い", async () => {
    const { tenantId, ownerId } = await setupSite();
    const res = await call(
      "POST",
      `/v1/t/${tenantId}/tokens`,
      await bearer(ownerId, tenantId, "owner"),
      {
        name: "claude code",
        scopes: ["record:read"],
        expiresInDays: 30,
      },
    );
    expect(res.status).toBe(201);
    const issued = await res.json<Issued>();
    expect(issued.token).toMatch(/^plyrs_pat_[A-Za-z0-9_-]{43}$/);
    const rows = await env.DB.prepare("SELECT * FROM personal_access_tokens WHERE id = ?")
      .bind(issued.id)
      .all();
    expect(rows.results).toHaveLength(1);
    expect(JSON.stringify(rows.results)).not.toContain(issued.token);
    expect(JSON.stringify(rows.results)).not.toContain(issued.token.slice("plyrs_pat_".length));
    // 発行直後から検証でき、ロールは memberships から引く
    const verified = await verifyPat(env.DB, tenantId, issued.token, new Date());
    expect(verified).toMatchObject({
      tokenId: issued.id,
      userId: ownerId,
      role: "owner",
      scopes: ["record:read"],
    });
  });

  it("editor は 403(JWT が editor でも、D1 の現在のロールが owner でなくても)", async () => {
    const { tenantId, editorId } = await setupSite();
    const asEditor = await call(
      "POST",
      `/v1/t/${tenantId}/tokens`,
      await bearer(editorId, tenantId, "editor"),
      { name: "x", scopes: ["record:read"] },
    );
    expect(asEditor.status).toBe(403);
    const forgedOwner = await call(
      "POST",
      `/v1/t/${tenantId}/tokens`,
      await bearer(editorId, tenantId, "owner"),
      { name: "x", scopes: ["record:read"] },
    );
    expect(forgedOwner.status).toBe(403);
  });

  it("record:publish を含む発行の上限は 90 日、読み取りのみは 365 日。超えると 400", async () => {
    const { tenantId, ownerId } = await setupSite();
    const auth = await bearer(ownerId, tenantId, "owner");
    const path = `/v1/t/${tenantId}/tokens`;
    expect(
      (
        await call("POST", path, auth, {
          name: "p",
          scopes: ["record:read", "record:publish"],
          expiresInDays: 90,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call("POST", path, auth, {
          name: "p",
          scopes: ["record:read", "record:publish"],
          expiresInDays: 91,
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("POST", path, auth, { name: "r", scopes: ["record:read"], expiresInDays: 365 }))
        .status,
    ).toBe(201);
    expect(
      (await call("POST", path, auth, { name: "r", scopes: ["record:read"], expiresInDays: 366 }))
        .status,
    ).toBe(400);
  });

  it("既定の期限は読み取りのみ 90 日、書き込み付き 30 日", async () => {
    const { tenantId, ownerId } = await setupSite();
    const auth = await bearer(ownerId, tenantId, "owner");
    const read = await (
      await call("POST", `/v1/t/${tenantId}/tokens`, auth, { name: "r", scopes: ["record:read"] })
    ).json<Issued>();
    const write = await (
      await call("POST", `/v1/t/${tenantId}/tokens`, auth, { name: "w", scopes: ["record:write"] })
    ).json<Issued>();
    expect(daysFromNow(read.expiresAt)).toBe(90);
    expect(daysFromNow(write.expiresAt)).toBe(30);
  });

  it("入力の検証: 空のスコープ・重複・未知のスコープ・名前が空は 400", async () => {
    const { tenantId, ownerId } = await setupSite();
    const auth = await bearer(ownerId, tenantId, "owner");
    const path = `/v1/t/${tenantId}/tokens`;
    for (const body of [
      { name: "x", scopes: [] },
      { name: "x", scopes: ["record:read", "record:read"] },
      { name: "x", scopes: ["member:manage"] },
      { name: "", scopes: ["record:read"] },
      { name: "x".repeat(101), scopes: ["record:read"] },
    ]) {
      expect((await call("POST", path, auth, body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("GET / DELETE /v1/t/:tenantId/tokens", () => {
  it("一覧に token_hash は無く、失効後は verifyPat が null になり、監査ログに 2 行残る", async () => {
    const { tenantId, ownerId } = await setupSite();
    const auth = await bearer(ownerId, tenantId, "owner");
    const issued = await (
      await call("POST", `/v1/t/${tenantId}/tokens`, auth, { name: "ci", scopes: ["record:read"] })
    ).json<Issued>();

    const listed = await call("GET", `/v1/t/${tenantId}/tokens`, auth);
    expect(listed.status).toBe(200);
    const body = await listed.json<{ tokens: Record<string, unknown>[] }>();
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]).toMatchObject({
      id: issued.id,
      name: "ci",
      scopes: ["record:read"],
      revokedAt: null,
    });
    expect(JSON.stringify(body)).not.toContain("hash");
    expect(JSON.stringify(body)).not.toContain(issued.token);

    const revoked = await call("DELETE", `/v1/t/${tenantId}/tokens/${issued.id}`, auth);
    expect(revoked.status).toBe(200);
    expect(await verifyPat(env.DB, tenantId, issued.token, new Date())).toBeNull();
    expect((await call("DELETE", `/v1/t/${tenantId}/tokens/${issued.id}`, auth)).status).toBe(404);

    const actions = (
      await drizzle(env.DB)
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.targetId, issued.id))
    ).map((row) => row.action);
    expect(actions).toEqual(["token.issue", "token.revoke"]);
  });

  it("editor は一覧も失効もできない", async () => {
    const { tenantId, editorId } = await setupSite();
    const auth = await bearer(editorId, tenantId, "editor");
    expect((await call("GET", `/v1/t/${tenantId}/tokens`, auth)).status).toBe(403);
    expect(
      (await call("DELETE", `/v1/t/${tenantId}/tokens/${crypto.randomUUID()}`, auth)).status,
    ).toBe(403);
  });

  it("別テナントの PAT は失効できない(テナント境界)", async () => {
    const a = await setupSite();
    const b = await setupSite();
    const issued = await (
      await call(
        "POST",
        `/v1/t/${a.tenantId}/tokens`,
        await bearer(a.ownerId, a.tenantId, "owner"),
        {
          name: "a",
          scopes: ["record:read"],
        },
      )
    ).json<Issued>();
    const res = await call(
      "DELETE",
      `/v1/t/${b.tenantId}/tokens/${issued.id}`,
      await bearer(b.ownerId, b.tenantId, "owner"),
    );
    expect(res.status).toBe(404);
    expect(await verifyPat(env.DB, a.tenantId, issued.token, new Date())).not.toBeNull();
  });
});

describe("verifyPat", () => {
  it("期限切れ・別テナント・会員でなくなった利用者は null。last_used_at は 1 時間に 1 回だけ更新する", async () => {
    const { tenantId, ownerId } = await setupSite();
    const auth = await bearer(ownerId, tenantId, "owner");
    const issued = await (
      await call("POST", `/v1/t/${tenantId}/tokens`, auth, {
        name: "x",
        scopes: ["record:read"],
        expiresInDays: 1,
      })
    ).json<Issued>();
    const now = new Date();
    expect(await verifyPat(env.DB, tenantId, issued.token, now)).not.toBeNull();
    expect(await verifyPat(env.DB, crypto.randomUUID(), issued.token, now)).toBeNull();
    expect(
      await verifyPat(env.DB, tenantId, issued.token, new Date(now.getTime() + 2 * 86_400_000)),
    ).toBeNull();
    expect(await verifyPat(env.DB, tenantId, "plyrs_pat_nope", now)).toBeNull();

    const lastUsed = async () =>
      (
        await env.DB.prepare("SELECT last_used_at FROM personal_access_tokens WHERE id = ?")
          .bind(issued.id)
          .first<{ last_used_at: string | null }>()
      )?.last_used_at;
    expect(await lastUsed()).toBe(now.toISOString());
    const soon = new Date(now.getTime() + 10 * 60_000);
    await verifyPat(env.DB, tenantId, issued.token, soon);
    expect(await lastUsed()).toBe(now.toISOString());
    const later = new Date(now.getTime() + 61 * 60_000);
    await verifyPat(env.DB, tenantId, issued.token, later);
    expect(await lastUsed()).toBe(later.toISOString());

    await drizzle(env.DB).delete(memberships).where(eq(memberships.userId, ownerId));
    expect(await verifyPat(env.DB, tenantId, issued.token, now)).toBeNull();
  });
});

describe("会員資格と PAT の連動", () => {
  it("会員を外すとその人の PAT は失効し、再招待しても戻らない。監査に token.revoke が残る", async () => {
    const { tenantId, ownerId, editorId } = await setupSite();
    const auth = await bearer(ownerId, tenantId, "owner");
    const now = new Date();
    const issued = await issuePat(
      env.DB,
      { userId: editorId, tenantId, name: "editor-ci", scopes: ["record:read"], expiresInDays: 1 },
      now,
    );
    expect(await verifyPat(env.DB, tenantId, issued.token, now)).not.toBeNull();

    const removed = await call("DELETE", `/v1/t/${tenantId}/members/${editorId}`, auth);
    expect(removed.status).toBe(200);
    expect(await verifyPat(env.DB, tenantId, issued.token, now)).toBeNull();

    // 再招待(ブロックの解除)で PAT が蘇らない
    const editorEmail = (
      await drizzle(env.DB).select({ email: users.email }).from(users).where(eq(users.id, editorId))
    )[0]?.email;
    const readded = await call("POST", `/v1/t/${tenantId}/members`, auth, {
      email: editorEmail,
      role: "editor",
    });
    expect(readded.status).toBe(201);
    expect(await verifyPat(env.DB, tenantId, issued.token, now)).toBeNull();

    const audits = await drizzle(env.DB)
      .select({ action: auditLogs.action, actorId: auditLogs.actorId, detail: auditLogs.detail })
      .from(auditLogs)
      .where(eq(auditLogs.targetId, issued.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "token.revoke", actorId: ownerId });
    expect(JSON.parse(audits[0]?.detail ?? "{}")).toStrictEqual({
      tenantId,
      reason: "member.remove",
    });
  });

  it("BAN はその人の全テナントの PAT を失効させる", async () => {
    const a = await setupSite();
    const b = await setupSite();
    const now = new Date();
    await drizzle(env.DB).insert(memberships).values({
      userId: a.editorId,
      tenantId: b.tenantId,
      role: "editor",
      createdAt: now.toISOString(),
    });
    const tokens = await Promise.all(
      [a.tenantId, b.tenantId].map((tenantId) =>
        issuePat(
          env.DB,
          { userId: a.editorId, tenantId, name: "t", scopes: ["record:read"], expiresInDays: 1 },
          now,
        ),
      ),
    );
    const { revokedTokens } = await banUserEverywhere(env, a.editorId);
    expect(revokedTokens.toSorted()).toEqual(tokens.map((t) => t.id).toSorted());
    expect(await verifyPat(env.DB, a.tenantId, tokens[0]?.token ?? "", now)).toBeNull();
    expect(await verifyPat(env.DB, b.tenantId, tokens[1]?.token ?? "", now)).toBeNull();
  });
});
