import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { memberships, tenants } from "@plyrs/db/control-plane";
import { writeAudit } from "../audit";
import { isBlocked, isMembershipBlocked } from "../auth/blocklist";
import { allowedScopes, type PatScope } from "../auth/pat";
import { isRole, type Role } from "../auth/permissions";
import { lookupSessionUser, SESSION_COOKIE } from "../auth/session";
import { consentScopes, renderConsentPage, renderErrorPage } from "./consent-page";
import { createTenantAuthServer, type McpGrantProps } from "./server";

// design-spec 16.2・16.3(M3-2): /oauth/t/:tenantId/authorize の同意の手続き。admin から転送されて来るので
// admin オリジンのセッション cookie がそのまま届く(認可サーバーの入口で cookie を見るのはここだけ)。
// 順序: (1) parseAuthRequest、(2) セッション(無ければ /login?return_to= へ)、(3) BLOCKLIST、
// (4) memberships の現在のロール(会員でなければ 403)。POST 側でもロールでスコープを絞る(権限昇格の防止)。

// ルートのパスを型に含めることで c.req.param("tenantId") が string になる
type Ctx = Context<{ Bindings: Env }, "/t/:tenantId/authorize">;

function htmlResponse(body: string, status: number, headers?: Headers): Response {
  const h = new Headers(headers);
  h.set("content-type", "text/html; charset=utf-8");
  h.set("cache-control", "no-store");
  return new Response(body, { status, headers: h });
}

function errorPage(status: number, title: string, message: string): Response {
  return htmlResponse(renderErrorPage(title, message), status);
}

const NOT_MEMBER = errorPage(
  403,
  "接続できません",
  "このサイトのメンバーではありません。サイトの管理者に招待を依頼してください。",
);

// 同意に進める利用者か。会員でなければ null(呼び出し側が 401 / 403 の画面を返す)
async function currentMember(
  c: Ctx,
  tenantId: string,
): Promise<
  | { ok: true; userId: string; email: string; role: Role }
  | { ok: false; reason: "unauthenticated" | "blocked" | "not_member" }
> {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token === undefined ? null : await lookupSessionUser(c.env.DB, token, new Date());
  if (session === null || session.email === null) {
    return { ok: false, reason: "unauthenticated" };
  }
  if (
    (await isBlocked(c.env.BLOCKLIST, session.userId)) ||
    (await isMembershipBlocked(c.env.BLOCKLIST, session.userId, tenantId))
  ) {
    return { ok: false, reason: "blocked" };
  }
  const row = (
    await drizzle(c.env.DB)
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, session.userId), eq(memberships.tenantId, tenantId)))
      .limit(1)
  )[0];
  if (row === undefined || !isRole(row.role)) {
    return { ok: false, reason: "not_member" };
  }
  return { ok: true, userId: session.userId, email: session.email, role: row.role };
}

function memberFailure(reason: "unauthenticated" | "blocked" | "not_member"): Response {
  if (reason === "unauthenticated") {
    return errorPage(401, "ログインが必要です", "ログインしてから、もう一度接続を始めてください。");
  }
  if (reason === "blocked") {
    return errorPage(403, "接続できません", "このアカウントは利用を停止されています。");
  }
  return NOT_MEMBER.clone();
}

// ライブラリのヘルパーが投げる例外を画面に変える。AuthorizationError に redirectTo があるときだけ
// クライアントへ戻してよい(client と redirect_uri の検証が済んでいる)。それ以外は描画する
function helperError(error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectTo !== undefined) {
    return Response.redirect(error.redirectTo, 302);
  }
  if (error instanceof AuthorizationError) {
    return errorPage(400, "接続の要求が不正です", error.description ?? error.code);
  }
  if (error instanceof CimdFetchError) {
    return errorPage(400, "接続できません", "このアプリを確認できませんでした。");
  }
  throw error;
}

export async function handleAuthorizeGet(c: Ctx): Promise<Response> {
  const tenantId = c.req.param("tenantId");
  const server = createTenantAuthServer(c.env, tenantId);
  if (server === null) {
    return c.json({ error: "not_configured", what: "ADMIN_ORIGIN / API_ORIGIN" }, 503);
  }
  const oauth = server.getOAuthApi(c.env);
  try {
    const request = await oauth.parseAuthRequest(c.req.raw);
    const member = await currentMember(c, tenantId);
    if (!member.ok && member.reason === "unauthenticated") {
      // ログイン後に同じ URL へ戻す(ロードマップ 8 章: /login の return_to は /oauth/t/ 配下だけ)
      const url = new URL(c.req.url);
      const login = new URL("/login", c.env.ADMIN_ORIGIN);
      login.searchParams.set("return_to", url.pathname + url.search);
      return Response.redirect(login.toString(), 302);
    }
    if (!member.ok) {
      return memberFailure(member.reason);
    }
    const tenant = (
      await drizzle(c.env.DB)
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
    )[0];
    // describeConsent を先に呼ぶ(client の解決に失敗したとき KV に何も残さない)
    const details = await oauth.describeConsent(request);
    const consent = await oauth.beginConsent(request);
    return htmlResponse(
      renderConsentPage({
        details,
        handle: consent.handle,
        scopes: consentScopes(member.role, request.scope),
        tenantName: tenant?.name ?? tenantId,
        email: member.email,
      }),
      200,
      consent.headers,
    );
  } catch (error) {
    return helperError(error);
  }
}

export async function handleAuthorizePost(c: Ctx): Promise<Response> {
  const tenantId = c.req.param("tenantId");
  const server = createTenantAuthServer(c.env, tenantId);
  if (server === null) {
    return c.json({ error: "not_configured", what: "ADMIN_ORIGIN / API_ORIGIN" }, 503);
  }
  const oauth = server.getOAuthApi(c.env);
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return errorPage(400, "接続の要求が不正です", "同意画面からやり直してください。");
  }
  const handle = form.get("handle");
  if (typeof handle !== "string" || handle.length === 0) {
    return errorPage(400, "接続の要求が不正です", "同意画面からやり直してください。");
  }
  // セッションとロールは POST でも確かめ直す(handle はブラウザに束縛されるが、誰の権限かは cookie が決める)
  const member = await currentMember(c, tenantId);
  if (!member.ok) {
    return memberFailure(member.reason);
  }
  const allowed = new Set<string>(allowedScopes(member.role));
  const scope = form
    .getAll("scope")
    .filter((s): s is string => typeof s === "string")
    .filter((s): s is PatScope => allowed.has(s));
  try {
    // 許可しない、またはスコープを 1 つも選ばない承認は拒否として扱う(空のスコープのグラントを作らない)
    if (form.get("decision") !== "approve" || scope.length === 0) {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(c.req.raw, handle, { scope });
    const props: McpGrantProps = { userId: member.userId, tenantId, role: member.role };
    const { redirectTo } = await oauth.completeAuthorization({
      // フォームの値ではなく、KV に保存された要求を使う
      request: approved.request,
      userId: member.userId,
      metadata: { tenantId },
      scope: approved.request.scope,
      props,
    });
    // 監査の targetId は失効(oauth.revoke)と同じグラント ID(認可コード `userId:grantId:secret` の 2 要素目)。
    // 同じ付与を idx_audit_logs_target で追えるようにする
    const code = new URL(redirectTo).searchParams.get("code") ?? "";
    await writeAudit(c.env.DB, {
      actorId: member.userId,
      action: "oauth.grant",
      targetType: "oauth_grant",
      targetId: code.split(":")[1] ?? approved.request.clientId,
      detail: {
        tenantId,
        clientId: approved.request.clientId,
        scopes: approved.request.scope,
        redirectHost: new URL(approved.request.redirectUri).host,
      },
    });
    approved.headers.set("location", redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo === undefined) {
      return errorPage(
        400,
        "同意画面の有効期限が切れたか、使用済みです",
        "クライアントから接続をやり直してください。",
      );
    }
    return helperError(error);
  }
}
