import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it } from "vitest";
import { auditLogs, deadLetters, memberships, tenants } from "@plyrs/db/control-plane";
import { app } from "../src/index";
import { articleType, validArticleInput } from "./fixtures";
import { resetSuperAdmins, superEnv, superLogin } from "./super-login";

// super-tenants.test.ts / super-users.test.ts / super-triggers.test.ts の super HTTP 様式
// (superLogin + superEnv + cookie リクエスト)と、gate.test.ts / content-types-list.test.ts の
// owner HTTP 様式(signup → /auth/token → 型登録 → record 書き込み → publish)を、
// module-flow.test.ts と同じ「1 本のシナリオで面を縦断する」形に組み立てる。
// DO RPC を直叩きせず、すべて実 HTTP 経路(app.request)を通す ―― 特権運用の縦断確認が目的のため。

const RUN_ID = crypto.randomUUID().slice(0, 8);
let n = 0;
function unique(prefix: string): string {
  n += 1;
  return `${prefix}${RUN_ID}-${n}`;
}

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

// super-tenants.test.ts / super-users.test.ts と同じ super cookie リクエスト様式。
function superReq(method: string, path: string, cookie: string, body?: unknown): Request {
  return new Request(`https://api.test${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// Queue の配送は非同期(miniflare のブローカ経由)。super-triggers.test.ts / dead-letters.test.ts
// と同じポーリング様式。
async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for the condition");
    }
    await scheduler.wait(25);
  }
}

async function projectedRecord(
  tenantId: string,
  recordId: string,
): Promise<{ record_id: string } | null> {
  return env.PROJECTION_DB.prepare(
    "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
  )
    .bind(tenantId, recordId)
    .first<{ record_id: string }>();
}

// tenant_modules はこのシナリオでは触らないため掃除不要。super_admins/sessions と dead_letters
// (dead-letters.test.ts と同じ共有 D1 のリーク対策)だけを afterEach で戻す。
afterEach(async () => {
  await resetSuperAdmins();
  await drizzle(env.DB).delete(deadLetters);
});

describe("特権テナント運用 一気通貫 (Phase 10)", () => {
  it("bootstrap → super テナント作成 → owner の公開 → 健全性 → 再投影 → BAN → 削除が一巡する", async () => {
    // 1. bootstrap → super login(super cookie 取得)
    const { cookie: superCookie, adminId } = await superLogin();
    const e = superEnv();

    // super がテナント owner として任命する既存 user をまず signup で用意する
    const ownerEmail = `${unique("owner")}@example.com`;
    const signup = await app.request(
      "/auth/signup",
      json({ email: ownerEmail, password: "hunter2hunter2" }),
      e,
    );
    expect(signup.status).toBe(201);
    const { userId: ownerId } = (await signup.json()) as { userId: string };
    const ownerCookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    // 2. super がテナント作成(ownerEmail で既存 user を owner 任命)
    const tenantSlug = unique("t-");
    const created = await app.request(
      superReq("POST", "/super/v1/tenants", superCookie, {
        name: "特権運用シナリオ",
        slug: tenantSlug,
        ownerEmail,
      }),
      undefined,
      e,
    );
    expect(created.status).toBe(201);
    const { tenantId } = (await created.json()) as { tenantId: string };

    const ownerMembership = await drizzle(env.DB)
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, ownerId)));
    expect(ownerMembership).toEqual([{ role: "owner" }]);

    // 3. owner が型 + record 作成 → publish → 投影着地をポーリング
    const issued = await app.request("/auth/token", json({ tenantId }, { cookie: ownerCookie }), e);
    expect(issued.status).toBe(200);
    const { token: ownerToken } = (await issued.json()) as { token: string };
    const ownerAuth = { authorization: `Bearer ${ownerToken}` };

    const typeRes = await app.request(
      `/v1/t/${tenantId}/content-types`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", ...ownerAuth },
        body: JSON.stringify(articleType()),
      },
      e,
    );
    expect(typeRes.status).toBe(200);

    const recordId = crypto.randomUUID();
    const writeRes = await app.request(
      `/v1/t/${tenantId}/records/article/${recordId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", ...ownerAuth },
        body: JSON.stringify({ input: validArticleInput() }),
      },
      e,
    );
    expect(writeRes.status).toBe(200);

    const publishRes = await app.request(
      `/v1/t/${tenantId}/records/${recordId}/publish`,
      { method: "POST", headers: ownerAuth },
      e,
    );
    expect(publishRes.status).toBe(200);

    await waitFor(() => projectedRecord(tenantId, recordId));

    // 4. super: GET health → archivedPublished 0 件
    const healthBefore = await app.request(
      `/super/v1/tenants/${tenantId}/health`,
      { headers: { cookie: superCookie } },
      e,
    );
    expect(healthBefore.status).toBe(200);
    const healthBeforeBody = (await healthBefore.json()) as {
      archivedPublished: { recordId: string }[];
    };
    expect(healthBeforeBody.archivedPublished).toEqual([]);

    // 5. record を archive(status 変更)→ GET health に現れる
    // (publish 済みスナップショットは status 変更の影響を受けない — design-spec §7)
    const archiveRes = await app.request(
      `/v1/t/${tenantId}/records/article/${recordId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", ...ownerAuth },
        body: JSON.stringify({ input: validArticleInput(), status: "archived" }),
      },
      e,
    );
    expect(archiveRes.status).toBe(200);

    const healthAfter = await app.request(
      `/super/v1/tenants/${tenantId}/health`,
      { headers: { cookie: superCookie } },
      e,
    );
    const healthAfterBody = (await healthAfter.json()) as {
      archivedPublished: { recordId: string; type: string }[];
    };
    expect(healthAfterBody.archivedPublished).toContainEqual(
      expect.objectContaining({ recordId, type: "article" }),
    );

    // 6. super: 投影 D1 の行を直接 DELETE(乖離)→ POST reproject → 投影復元をポーリング
    await env.PROJECTION_DB.prepare(
      "DELETE FROM projected_records WHERE tenant_id = ? AND record_id = ?",
    )
      .bind(tenantId, recordId)
      .run();
    expect(await projectedRecord(tenantId, recordId)).toBeNull();

    const reprojectRes = await app.request(
      superReq("POST", `/super/v1/tenants/${tenantId}/reproject`, superCookie),
      undefined,
      e,
    );
    expect(reprojectRes.status).toBe(200);
    const reprojectBody = (await reprojectRes.json()) as { ok: true; epoch: number };
    expect(reprojectBody.ok).toBe(true);
    expect(typeof reprojectBody.epoch).toBe("number");

    await waitFor(() => projectedRecord(tenantId, recordId));

    // 7. super: POST users/:id/ban → owner の POST /auth/token が 403
    const banRes = await app.request(
      superReq("POST", `/super/v1/users/${ownerId}/ban`, superCookie),
      undefined,
      e,
    );
    expect(banRes.status).toBe(200);
    expect(await banRes.json()).toMatchObject({ ok: true });

    // ban 後の 403 は KV blocklist 由来({error:"blocked"})。セッション cookie 自体は
    // 生きたまま(ログアウトしていない)なので、/auth/token の isBlocked チェックで弾かれることを確認する。
    const blockedToken = await app.request(
      "/auth/token",
      json({ tenantId }, { cookie: ownerCookie }),
      e,
    );
    expect(blockedToken.status).toBe(403);
    expect(await blockedToken.json()).toEqual({ error: "blocked" });

    // 8. super: DELETE tenants/:id → 公開 API(tenant-resolver 経由)404 / 投影・R2・control-plane が空
    const deleteRes = await app.request(
      superReq("DELETE", `/super/v1/tenants/${tenantId}`, superCookie),
      undefined,
      e,
    );
    expect(deleteRes.status).toBe(200);

    // 注意: 削除前に公開 API を叩くと tenant-resolver の KV に正キャッシュ(300s)や Cache API の
    // 200 レスポンス(30s)が乗ってしまう。このシナリオでは公開 API を一度も叩かず、削除後の
    // 1 回だけで確認する(cache bust 不要)。
    const publicRes = await app.request(
      `/public/v1/${tenantSlug}/records/article/${recordId}`,
      {},
      e,
    );
    expect(publicRes.status).toBe(404);
    expect(await publicRes.json()).toEqual({ error: "unknown_tenant" });

    expect(await projectedRecord(tenantId, recordId)).toBeNull();
    const projectedCount = await env.PROJECTION_DB.prepare(
      "SELECT COUNT(*) AS n FROM projected_records WHERE tenant_id = ?",
    )
      .bind(tenantId)
      .first<{ n: number }>();
    expect(projectedCount?.n).toBe(0);
    expect((await env.ASSETS.list({ prefix: `${tenantId}/` })).objects).toHaveLength(0);
    expect(
      await drizzle(env.DB).select().from(tenants).where(eq(tenants.id, tenantId)),
    ).toHaveLength(0);
    expect(
      await drizzle(env.DB).select().from(memberships).where(eq(memberships.tenantId, tenantId)),
    ).toHaveLength(0);

    // 9. audit_logs に tenant.create / reproject.start / user.ban / tenant.delete が蓄積
    // (この super admin(adminId)が起こした操作だけに絞り、他ファイルの監査行と混ざらないようにする)
    const actions = (
      await drizzle(env.DB)
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.actorId, adminId))
    ).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining(["tenant.create", "reproject.start", "user.ban", "tenant.delete"]),
    );
  });
});
