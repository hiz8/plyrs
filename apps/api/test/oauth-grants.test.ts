import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { auditLogs } from "@plyrs/db/control-plane";
import { signTenantToken } from "../src/auth/jwt";
import type { Role } from "../src/auth/permissions";
import { app } from "../src/index";
import { authenticateMcpToken } from "../src/middleware/mcp-gate";
import { tenantResource } from "../src/oauth/server";
import {
  API_ORIGIN,
  authorize,
  insertMember,
  insertTenant,
  oauthEnv,
  type Issued,
} from "./oauth-helpers";

// M3-5(design-spec 16.3): 管理画面の「接続中のアプリ」。所有者(member:manage)がテナント全員の OAuth の
// 付与を一覧し、失効させる。付与は OAUTH_KV に利用者単位で置かれているので、会員ごとに listUserGrants を
// 呼んでこのテナントの resource の行だけを残す。

interface TenantGrant {
  id: string;
  userId: string;
  email: string;
  clientId: string;
  clientName: string | null;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
}

async function bearer(userId: string, tenantId: string, role: Role): Promise<string> {
  return `Bearer ${await signTenantToken(env.JWT_SECRET, { userId, tenantId, role })}`;
}

async function call(method: string, path: string, auth: string): Promise<Response> {
  return app.request(path, { method, headers: { authorization: auth } }, oauthEnv());
}

async function setup(): Promise<{
  tenantId: string;
  owner: { userId: string; email: string };
  editor: { userId: string; email: string };
  ownerGrant: Issued;
  editorGrant: Issued;
}> {
  const tenantId = await insertTenant();
  const owner = await insertMember(tenantId, "owner");
  const editor = await insertMember(tenantId, "editor");
  const ownerGrant = await authorize(tenantId, ["record:read", "record:publish"], {
    userId: owner.userId,
    role: "owner",
  });
  const editorGrant = await authorize(tenantId, ["record:read"], {
    userId: editor.userId,
    role: "editor",
  });
  return { tenantId, owner, editor, ownerGrant, editorGrant };
}

describe("/v1/t/:tenantId/oauth-grants", () => {
  it("所有者は自分と編集者の付与を email 付きで一覧でき、別テナントの付与は混ざらない", async () => {
    const { tenantId, owner, editor, ownerGrant, editorGrant } = await setup();
    // 同じ編集者が別テナントでも付与している(混ざってはいけない)
    const otherTenantId = await insertTenant();
    await insertMember(otherTenantId, "owner");
    const foreign = await authorize(otherTenantId, ["record:read"]);
    const res = await call(
      "GET",
      `/v1/t/${tenantId}/oauth-grants`,
      await bearer(owner.userId, tenantId, "owner"),
    );
    expect(res.status).toBe(200);
    const { grants } = await res.json<{ grants: TenantGrant[] }>();
    expect(grants.map((g) => g.id).sort()).toEqual(
      [ownerGrant.access_token.split(":")[1], editorGrant.access_token.split(":")[1]].sort(),
    );
    expect(grants.map((g) => g.clientId)).not.toContain(foreign.clientId);
    const ownerRow = grants.find((g) => g.userId === owner.userId);
    expect(ownerRow).toMatchObject({
      email: owner.email,
      clientId: ownerGrant.clientId,
      clientName: "test client",
      scopes: ["record:read", "record:publish"],
    });
    expect(Date.parse(ownerRow?.createdAt ?? "")).not.toBeNaN();
    // refresh token の既定の TTL(30 日)がグラントの期限になる
    expect(Date.parse(ownerRow?.expiresAt ?? "")).toBeGreaterThan(Date.now());
    expect(grants.find((g) => g.userId === editor.userId)?.email).toBe(editor.email);
    // 暗号化された props や token の素材は応答に出さない
    expect(JSON.stringify(grants)).not.toContain("encryptedProps");
  });

  it("編集者は一覧も失効もできない(403)", async () => {
    const { tenantId, editor, editorGrant } = await setup();
    const auth = await bearer(editor.userId, tenantId, "editor");
    expect((await call("GET", `/v1/t/${tenantId}/oauth-grants`, auth)).status).toBe(403);
    const grantId = editorGrant.access_token.split(":")[1];
    expect(
      (await call("DELETE", `/v1/t/${tenantId}/oauth-grants/${editor.userId}/${grantId}`, auth))
        .status,
    ).toBe(403);
  });

  it("失効すると一覧から消え、その access token は MCP の入口で 401、監査ログに oauth.revoke が残る", async () => {
    const { tenantId, owner, editor, editorGrant } = await setup();
    const auth = await bearer(owner.userId, tenantId, "owner");
    const grantId = editorGrant.access_token.split(":")[1] ?? "";
    const res = await call(
      "DELETE",
      `/v1/t/${tenantId}/oauth-grants/${editor.userId}/${grantId}`,
      auth,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const listed = await (
      await call("GET", `/v1/t/${tenantId}/oauth-grants`, auth)
    ).json<{ grants: TenantGrant[] }>();
    expect(listed.grants.map((g) => g.id)).not.toContain(grantId);
    expect(
      await authenticateMcpToken(
        oauthEnv(),
        tenantId,
        editorGrant.access_token,
        tenantResource(API_ORIGIN, tenantId),
      ),
    ).toEqual({ ok: false, code: "unauthenticated", status: 401 });
    const actions = (
      await drizzle(env.DB)
        .select({ action: auditLogs.action, actorId: auditLogs.actorId })
        .from(auditLogs)
        .where(eq(auditLogs.targetId, grantId))
    ).map((row) => `${row.action}:${row.actorId}`);
    expect(actions).toEqual([`oauth.revoke:${owner.userId}`]);
    // 2 回目は 404
    expect(
      (await call("DELETE", `/v1/t/${tenantId}/oauth-grants/${editor.userId}/${grantId}`, auth))
        .status,
    ).toBe(404);
  });

  it("別テナントの付与は失効できない(404。利用者が両方の会員でも)", async () => {
    const a = await setup();
    const b = await insertTenant();
    const bOwner = await insertMember(b, "owner");
    // a の編集者を b の会員にもする。b の所有者が a の付与を消そうとしても 404
    const grantId = a.editorGrant.access_token.split(":")[1] ?? "";
    const res = await call(
      "DELETE",
      `/v1/t/${b}/oauth-grants/${a.editor.userId}/${grantId}`,
      await bearer(bOwner.userId, b, "owner"),
    );
    expect(res.status).toBe(404);
    expect(
      (
        await authenticateMcpToken(
          oauthEnv(),
          a.tenantId,
          a.editorGrant.access_token,
          tenantResource(API_ORIGIN, a.tenantId),
        )
      ).ok,
    ).toBe(true);
  });
});
