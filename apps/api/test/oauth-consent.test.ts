import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs } from "@plyrs/db/control-plane";
import { blockUser, unblockUser } from "../src/auth/blocklist";
import type { Role } from "../src/auth/permissions";
import { createSession, SESSION_COOKIE } from "../src/auth/session";
import { app } from "../src/index";
import { createTenantAuthServer, tenantIssuer, tenantResource } from "../src/oauth/server";
import {
  ADMIN_ORIGIN,
  API_ORIGIN,
  authorizeUrl,
  CTX,
  insertMember,
  insertTenant,
  oauthEnv,
  pkce,
  REDIRECT_URI,
  registerClient,
  tokenRequest,
  type TokenResponse,
} from "./oauth-helpers";

// M3-2(design-spec 16.2・16.3、論点 C3・C5・D1): 同意画面。未ログインは /login?return_to= へ、会員でなければ
// 403、スコープはロールの範囲に絞り、record:publish は既定で外す。POST 側でも絞る(Review Focus 2)。

async function sessionCookie(userId: string): Promise<string> {
  const { token } = await createSession(env.DB, userId, new Date());
  return `${SESSION_COOKIE}=${token}`;
}

interface Flow {
  tenantId: string;
  clientId: string;
  url: URL;
  verifier: string;
}

async function startFlow(scope: readonly string[]): Promise<Flow> {
  const tenantId = await insertTenant("ブログ");
  const clientId = await registerClient(tenantId);
  const { verifier, challenge } = await pkce();
  return { tenantId, clientId, url: authorizeUrl(tenantId, clientId, scope, challenge), verifier };
}

async function getAuthorize(flow: Flow, cookie?: string): Promise<Response> {
  return app.request(
    flow.url,
    { headers: cookie === undefined ? {} : { cookie } },
    oauthEnv(),
    CTX,
  );
}

function consentCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  expect(setCookie).toMatch(/^__Host-oauth-consent-/);
  return setCookie.split(";")[0]!;
}

function handleOf(html: string): string {
  const match = /name="handle" value="([^"]+)"/.exec(html);
  expect(match).not.toBeNull();
  return match![1]!;
}

async function postAuthorize(
  flow: Flow,
  cookies: string[],
  form: Record<string, string | string[]>,
): Promise<Response> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      body.append(key, v);
    }
  }
  return app.request(
    flow.url,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookies.join("; "),
      },
      body,
    },
    oauthEnv(),
    CTX,
  );
}

// GET → POST(approve)の一巡。承認したスコープで token を得る
async function consentAndExchange(
  flow: Flow,
  session: string,
  scope: string[],
): Promise<{ redirect: Response; token: Response }> {
  const page = await getAuthorize(flow, session);
  expect(page.status).toBe(200);
  const html = await page.text();
  const redirect = await postAuthorize(flow, [session, consentCookie(page)], {
    decision: "approve",
    handle: handleOf(html),
    scope,
  });
  expect(redirect.status).toBe(302);
  const location = new URL(redirect.headers.get("location") ?? "");
  const code = location.searchParams.get("code");
  expect(code).not.toBeNull();
  const token = await tokenRequest(flow.tenantId, {
    grant_type: "authorization_code",
    code: code!,
    redirect_uri: REDIRECT_URI,
    client_id: flow.clientId,
    code_verifier: flow.verifier,
    resource: tenantResource(API_ORIGIN, flow.tenantId),
  });
  return { redirect, token };
}

async function validate(tenantId: string, accessToken: string) {
  return createTenantAuthServer(oauthEnv(), tenantId)!.validateToken(
    tenantResource(API_ORIGIN, tenantId),
    accessToken,
    oauthEnv(),
  );
}

async function memberWithSession(tenantId: string, role: Role) {
  const member = await insertMember(tenantId, role);
  return { ...member, session: await sessionCookie(member.userId) };
}

describe("GET /oauth/t/:tenantId/authorize", () => {
  it("未ログインなら /login?return_to=(パスとクエリ)へ 302", async () => {
    const flow = await startFlow(["record:read"]);
    const res = await getAuthorize(flow);
    expect(res.status).toBe(302);
    const expected = `${ADMIN_ORIGIN}/login?return_to=${encodeURIComponent(flow.url.pathname + flow.url.search)}`;
    expect(res.headers.get("location")).toBe(expected);
  });

  it("会員でない利用者は 403 の HTML", async () => {
    const flow = await startFlow(["record:read"]);
    const other = await insertMember(await insertTenant(), "owner");
    const res = await getAuthorize(flow, await sessionCookie(other.userId));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("このサイトのメンバーではありません");
  });

  it("BAN された利用者は 403", async () => {
    const flow = await startFlow(["record:read"]);
    const { userId, session } = await memberWithSession(flow.tenantId, "owner");
    await blockUser(env.BLOCKLIST, userId);
    try {
      expect((await getAuthorize(flow, session)).status).toBe(403);
    } finally {
      await unblockUser(env.BLOCKLIST, userId);
    }
  });

  it("編集者には record:read が checked で出て、record:publish は出ない", async () => {
    const flow = await startFlow(["record:read", "record:publish"]);
    const { session, email } = await memberWithSession(flow.tenantId, "editor");
    const res = await getAuthorize(flow, session);
    expect(res.status).toBe(200);
    consentCookie(res);
    const html = await res.text();
    expect(html).toContain("test client");
    expect(html).toContain("このパソコン上のアプリ");
    expect(html).toContain("ブログ");
    expect(html).toContain(email);
    expect(html).toMatch(/name="scope"\s+value="record:read"[^>]*checked/);
    expect(html).not.toContain('value="record:publish"');
  });

  it("所有者には record:publish が unchecked で出る", async () => {
    const flow = await startFlow(["record:read", "record:publish"]);
    const { session } = await memberWithSession(flow.tenantId, "owner");
    const html = await (await getAuthorize(flow, session)).text();
    expect(html).toContain('value="record:publish"');
    expect(html).not.toMatch(/name="scope"\s+value="record:publish"[^>]*checked/);
  });

  it("不正な client_id は 400 の HTML(リダイレクトしない)", async () => {
    const flow = await startFlow(["record:read"]);
    flow.url.searchParams.set("client_id", "nope");
    const { session } = await memberWithSession(flow.tenantId, "owner");
    const res = await getAuthorize(flow, session);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

describe("POST /oauth/t/:tenantId/authorize", () => {
  it("承認するとコードが発行され、token の scope と props.role が D1 のとおり", async () => {
    const flow = await startFlow(["record:read"]);
    const { session, userId } = await memberWithSession(flow.tenantId, "editor");
    const { redirect, token } = await consentAndExchange(flow, session, ["record:read"]);
    const location = new URL(redirect.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get("state")).toBe("st");
    expect(location.searchParams.get("iss")).toBe(tenantIssuer(ADMIN_ORIGIN, flow.tenantId));
    expect(token.status).toBe(200);
    const body = await token.json<TokenResponse>();
    const validated = await validate(flow.tenantId, body.access_token);
    expect(validated?.scope).toEqual(["record:read"]);
    expect(validated?.props).toEqual({ userId, tenantId: flow.tenantId, role: "editor" });
    const audits = await drizzle(env.DB)
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, userId));
    expect(audits.map((a) => a.action)).toEqual(["oauth.grant"]);
    // targetId は失効(oauth.revoke)と同じグラント ID
    const code = location.searchParams.get("code") ?? "";
    expect(audits[0]?.targetId).toBe(code.split(":")[1]);
  });

  it("編集者がフォームに record:publish と type:manage を足しても付与されない(Review Focus 2)", async () => {
    const flow = await startFlow(["record:read"]);
    const { session } = await memberWithSession(flow.tenantId, "editor");
    const { token } = await consentAndExchange(flow, session, [
      "record:read",
      "record:publish",
      "type:manage",
    ]);
    const body = await token.json<TokenResponse>();
    expect((await validate(flow.tenantId, body.access_token))?.scope).toEqual(["record:read"]);
  });

  it("所有者は record:publish を付与できる", async () => {
    const flow = await startFlow(["record:read"]);
    const { session } = await memberWithSession(flow.tenantId, "owner");
    const { token } = await consentAndExchange(flow, session, ["record:read", "record:publish"]);
    const body = await token.json<TokenResponse>();
    expect((await validate(flow.tenantId, body.access_token))?.scope).toEqual([
      "record:read",
      "record:publish",
    ]);
  });

  it("許可しない → access_denied と state を付けてクライアントへ 302", async () => {
    const flow = await startFlow(["record:read"]);
    const { session } = await memberWithSession(flow.tenantId, "owner");
    const page = await getAuthorize(flow, session);
    const res = await postAuthorize(flow, [session, consentCookie(page)], {
      decision: "deny",
      handle: handleOf(await page.text()),
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("st");
  });

  it("スコープを 1 つも選ばない承認は拒否と同じ", async () => {
    const flow = await startFlow(["record:read"]);
    const { session } = await memberWithSession(flow.tenantId, "owner");
    const page = await getAuthorize(flow, session);
    const res = await postAuthorize(flow, [session, consentCookie(page)], {
      decision: "approve",
      handle: handleOf(await page.text()),
    });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "access_denied",
    );
  });

  it("セッション cookie が無い POST は 401 で、handle は消費されない", async () => {
    const flow = await startFlow(["record:read"]);
    const { session } = await memberWithSession(flow.tenantId, "owner");
    const page = await getAuthorize(flow, session);
    const consent = consentCookie(page);
    const handle = handleOf(await page.text());
    const anon = await postAuthorize(flow, [consent], {
      decision: "approve",
      handle,
      scope: "record:read",
    });
    expect(anon.status).toBe(401);
    const again = await postAuthorize(flow, [session, consent], {
      decision: "approve",
      handle,
      scope: "record:read",
    });
    expect(again.status).toBe(302);
    expect(new URL(again.headers.get("location") ?? "").searchParams.get("code")).not.toBeNull();
  });

  it("使い終わった handle の再 POST は 400 の HTML", async () => {
    const flow = await startFlow(["record:read"]);
    const { session } = await memberWithSession(flow.tenantId, "owner");
    const page = await getAuthorize(flow, session);
    const consent = consentCookie(page);
    const handle = handleOf(await page.text());
    await postAuthorize(flow, [session, consent], {
      decision: "approve",
      handle,
      scope: "record:read",
    });
    const replay = await postAuthorize(flow, [session, consent], {
      decision: "approve",
      handle,
      scope: "record:read",
    });
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("有効期限が切れたか、使用済み");
  });
});
