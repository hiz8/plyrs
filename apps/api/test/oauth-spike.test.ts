// spike(M0-3): 認可サーバー(@cloudflare/workers-oauth-provider v1 分割 API)の評価。
// 計測値は console.log に JSON で出す(結果ドキュメントへ転記する)。workerd(ローカル)上の値であり、
// 実環境の KV / D1 の遅延は含まない。
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { blockUser, unblockUser } from "../src/auth/blocklist";
import {
  AuthorizationError,
  OAuthAuthorizationServer,
  insufficientScope,
} from "@cloudflare/workers-oauth-provider";
import { authenticateMcpToken, mcpTokenValidator } from "../src/spike/mcp-gate";
import {
  ADMIN_ORIGIN,
  createTenantAuthServer,
  createTenantResourceServer,
  tenantFromIssuerPath,
  tenantIssuer,
  tenantResource,
} from "../src/spike/mcp-auth-server";
import { issuePat, PAT_TABLE_SQL, verifyPat } from "../src/spike/pat";
import { uuid } from "./fixtures";

const TENANT = uuid(900);
const OTHER_TENANT = uuid(901);
const USER = uuid(910);
const REDIRECT = "http://localhost:3333/callback";
const NOW = new Date();

const timings: Record<string, { n: number; p50: number; p90: number; mean: number }> = {};

async function measure(name: string, n: number, fn: () => Promise<unknown>): Promise<void> {
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]!;
  timings[name] = {
    n,
    p50: Number(at(0.5).toFixed(2)),
    p90: Number(at(0.9).toFixed(2)),
    mean: Number((samples.reduce((a, b) => a + b, 0) / n).toFixed(2)),
  };
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

interface Issued {
  accessToken: string;
  refreshToken: string | undefined;
  clientId: string;
}

// 認可コード + PKCE の一巡。/authorize は未ログイン → ログイン → 再入を模して parseAuthRequest を 2 回呼ぶ
async function authorize(
  as: OAuthAuthorizationServer<Env>,
  tenantId: string,
  scope: string[],
  options: { resource?: string } = {},
): Promise<Issued> {
  const oauth = as.getOAuthApi(env);
  const client = await oauth.createClient({
    redirectUris: [REDIRECT],
    clientName: "spike client",
    tokenEndpointAuthMethod: "none",
  });
  const { verifier, challenge } = await pkce();
  const url = new URL(`${tenantIssuer(tenantId)}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", REDIRECT);
  url.searchParams.set("scope", scope.join(" "));
  url.searchParams.set("state", "st");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", options.resource ?? tenantResource(tenantId));

  // 1 回目: 未ログインと判定してログインへ回す(状態は何も残らない)
  const first = await oauth.parseAuthRequest(new Request(url));
  // 2 回目: ログイン後に同じ URL へ戻ってくる
  const request = await oauth.parseAuthRequest(new Request(url));
  expect(request).toEqual(first);

  const { redirectTo } = await oauth.completeAuthorization({
    request,
    userId: USER,
    metadata: {},
    scope: request.scope,
    props: { userId: USER, tenantId, role: "editor" },
  });
  const code = new URL(redirectTo).searchParams.get("code");
  expect(code).not.toBeNull();

  const tokenRes = await as.fetch(
    new Request(`${tenantIssuer(tenantId)}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: REDIRECT,
        client_id: client.clientId,
        code_verifier: verifier,
        resource: options.resource ?? tenantResource(tenantId),
      }),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
  const body = await tokenRes.json<Record<string, unknown>>();
  expect(tokenRes.status, JSON.stringify(body)).toBe(200);
  return {
    accessToken: body["access_token"] as string,
    refreshToken: body["refresh_token"] as string | undefined,
    clientId: client.clientId,
  };
}

beforeAll(async () => {
  await env.DB.prepare(PAT_TABLE_SQL).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(USER, "spike@example.com", "x", NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(USER, TENANT, "editor", NOW.toISOString())
    .run();
});

describe("M0-3 spike: OAuth 認可サーバー(テナント別 issuer を要求ごとに構築)", () => {
  it("URL からテナントが決まる(authorize / token / register / well-known)", () => {
    expect(tenantFromIssuerPath(`/oauth/t/${TENANT}/authorize`)).toBe(TENANT);
    expect(tenantFromIssuerPath(`/oauth/t/${TENANT}/oauth/token`)).toBe(TENANT);
    expect(tenantFromIssuerPath(`/.well-known/oauth-authorization-server/oauth/t/${TENANT}`)).toBe(
      TENANT,
    );
    expect(tenantFromIssuerPath("/oauth/token")).toBeNull();
  });

  it("Authorization Server Metadata をパス付き issuer 配下で返す", async () => {
    const as = createTenantAuthServer(TENANT);
    const res = await as.fetch(
      new Request(`${ADMIN_ORIGIN}/.well-known/oauth-authorization-server/oauth/t/${TENANT}`),
      env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const meta = await res.json<Record<string, unknown>>();
    expect(meta["issuer"]).toBe(tenantIssuer(TENANT));
    expect(meta["authorization_endpoint"]).toBe(`${tenantIssuer(TENANT)}/authorize`);
    expect(meta["token_endpoint"]).toBe(`${tenantIssuer(TENANT)}/oauth/token`);
    expect(meta["protected_resources"]).toEqual([tenantResource(TENANT)]);
    expect(meta["code_challenge_methods_supported"]).toEqual(["S256"]);
    console.log("AS metadata keys:", Object.keys(meta).join(","));
  });

  it("認可コード + PKCE で token を得て、別インスタンスで検証できる(状態は KV にある)", async () => {
    const issued = await authorize(createTenantAuthServer(TENANT), TENANT, [
      "record:read",
      "record:write",
    ]);
    const other = createTenantAuthServer(TENANT);
    const validated = await other.validateToken(tenantResource(TENANT), issued.accessToken, env);
    expect(validated).not.toBeNull();
    expect(validated!.props).toEqual({ userId: USER, tenantId: TENANT, role: "editor" });
    expect(validated!.scope).toEqual(["record:read", "record:write"]);
    expect(validated!.userId).toBe(USER);
    expect(validated!.expiresAt - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(900);
    // 別テナントの issuer では audience が合わず拒否(例外: resources に無い)
    await expect(
      createTenantAuthServer(OTHER_TENANT).validateToken(
        tenantResource(TENANT),
        issued.accessToken,
        env,
      ),
    ).rejects.toThrow();
    expect(
      await createTenantAuthServer(OTHER_TENANT).validateToken(
        tenantResource(OTHER_TENANT),
        issued.accessToken,
        env,
      ),
    ).toBeNull();
  });

  it("resource に子孫パス(/mcp/t/<id>)を渡すと親 /mcp しか登録していない AS は拒否する", async () => {
    // 代替案(issuer 固定・resource は /mcp 1 つ)が採れない根拠。クライアントは 401 で得た PRM の
    // resource をそのまま送るので、テナント別の audience にするには resources に実値が要る
    const global = new OAuthAuthorizationServer<Env>({
      issuer: ADMIN_ORIGIN,
      resources: ["https://api.example/mcp"],
    });
    const oauth = global.getOAuthApi(env);
    const client = await oauth.createClient({
      redirectUris: [REDIRECT],
      tokenEndpointAuthMethod: "none",
    });
    const url = new URL(`${ADMIN_ORIGIN}/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.clientId);
    url.searchParams.set("redirect_uri", REDIRECT);
    url.searchParams.set("code_challenge", (await pkce()).challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("resource", tenantResource(TENANT));
    await expect(oauth.parseAuthRequest(new Request(url))).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("同意画面のヘルパー(beginConsent → approveConsent)はブラウザ束縛の cookie で一巡する", async () => {
    const as = createTenantAuthServer(TENANT);
    const oauth = as.getOAuthApi(env);
    const client = await oauth.createClient({
      redirectUris: [REDIRECT],
      clientName: "<b>evil</b>",
      tokenEndpointAuthMethod: "none",
    });
    const url = new URL(`${tenantIssuer(TENANT)}/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.clientId);
    url.searchParams.set("redirect_uri", REDIRECT);
    url.searchParams.set("scope", "record:read record:publish");
    url.searchParams.set("code_challenge", (await pkce()).challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("resource", tenantResource(TENANT));
    const request = await oauth.parseAuthRequest(new Request(url));
    const details = await oauth.describeConsent(request);
    expect(details.clientName).toBe("<b>evil</b>");
    expect(details.redirectHost).toBe("localhost");
    expect(details.redirectIsLoopback).toBe(true);
    const consent = await oauth.beginConsent(request);
    const cookie = consent.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-oauth-consent-/);
    // 所有者でないので record:publish を外して承認(16.3 論点 C5)
    const post = new Request(url, {
      method: "POST",
      headers: { cookie: cookie.split(";")[0]! },
    });
    const approved = await oauth.approveConsent(post, consent.handle, {
      scope: ["record:read"],
    });
    // approveConsent は承認したスコープに絞った request を返す(フォーム値ではなく KV の request が元)
    expect(approved.request.scope).toEqual(["record:read"]);
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: USER,
      metadata: {},
      scope: ["record:read"],
      props: { userId: USER, tenantId: TENANT, role: "editor" },
    });
    expect(new URL(redirectTo).searchParams.get("code")).not.toBeNull();
    // handle は 1 回限り
    await expect(oauth.approveConsent(post, consent.handle)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("CIMD を有効にした構築と metadata(compatibility flag は wrangler 側で要確認)", async () => {
    const as = createTenantAuthServer(TENANT, { cimd: true });
    const res = await as.fetch(
      new Request(`${ADMIN_ORIGIN}/.well-known/oauth-authorization-server/oauth/t/${TENANT}`),
      env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
    );
    const meta = await res.json<Record<string, unknown>>();
    console.log(
      "CIMD metadata:",
      JSON.stringify({
        client_id_metadata_document_supported: meta["client_id_metadata_document_supported"],
        registration_endpoint: meta["registration_endpoint"],
      }),
    );
  });
});

describe("M0-3 spike: PAT の検証経路と OAuth との合流", () => {
  it("PAT を発行・検証し、ロールは memberships から引く", async () => {
    const token = await issuePat(env.DB, {
      id: uuid(920),
      userId: USER,
      tenantId: TENANT,
      scopes: ["record:read"],
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });
    expect(token.startsWith("plyrs_pat_")).toBe(true);
    const verified = await verifyPat(env.DB, TENANT, token, NOW);
    expect(verified).toMatchObject({ userId: USER, role: "editor", scopes: ["record:read"] });
    expect(await verifyPat(env.DB, OTHER_TENANT, token, NOW)).toBeNull();
    expect(
      await verifyPat(env.DB, TENANT, token, new Date(NOW.getTime() + 2 * 86_400_000)),
    ).toBeNull();
    expect(await verifyPat(env.DB, TENANT, "plyrs_pat_nope", NOW)).toBeNull();
  });

  it("PAT と OAuth が同じ認可コンテキストに合流し、BLOCKLIST が両方に効果を持つ", async () => {
    const pat = await issuePat(env.DB, {
      id: uuid(921),
      userId: USER,
      tenantId: TENANT,
      scopes: ["record:read", "record:write"],
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });
    const oauth = await authorize(createTenantAuthServer(TENANT), TENANT, ["record:read"]);

    const viaPat = await authenticateMcpToken(env, TENANT, pat, NOW);
    const viaOauth = await authenticateMcpToken(env, TENANT, oauth.accessToken, NOW);
    expect(viaPat).toMatchObject({
      ok: true,
      auth: {
        userId: USER,
        role: "editor",
        tenantId: TENANT,
        via: "pat",
        scopes: ["record:read", "record:write"],
      },
    });
    expect(viaOauth).toMatchObject({
      ok: true,
      auth: {
        userId: USER,
        role: "editor",
        tenantId: TENANT,
        via: "oauth",
        scopes: ["record:read"],
      },
    });
    expect(await authenticateMcpToken(env, TENANT, "garbage", NOW)).toEqual({
      ok: false,
      code: "unauthenticated",
      status: 401,
    });

    await blockUser(env.BLOCKLIST, USER);
    try {
      expect((await authenticateMcpToken(env, TENANT, pat, NOW)).ok).toBe(false);
      expect((await authenticateMcpToken(env, TENANT, oauth.accessToken, NOW)).ok).toBe(false);
    } finally {
      await unblockUser(env.BLOCKLIST, USER);
    }
  });

  it("OAuthResourceServer: 401 の challenge、PRM、403 insufficient_scope、PAT の受け入れ", async () => {
    const rs = createTenantResourceServer(
      TENANT,
      mcpTokenValidator(TENANT),
      (request, _env, ctx) => {
        if (request.method === "DELETE" && !ctx.auth.scope.includes("record:delete")) {
          return insufficientScope(ctx.auth, ["record:delete"]);
        }
        return Response.json({ user: ctx.props.userId, via: ctx.auth.scope });
      },
    );
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const resource = tenantResource(TENANT);

    const anon = await rs.fetch(new Request(resource, { method: "POST" }), env, ctx);
    expect(anon.status).toBe(401);
    const challenge = anon.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(
      `resource_metadata="https://api.example/.well-known/oauth-protected-resource/mcp/t/${TENANT}"`,
    );
    expect(challenge).toContain('scope="record:read"');

    const prm = await rs.fetch(
      new Request(`https://api.example/.well-known/oauth-protected-resource/mcp/t/${TENANT}`),
      env,
      ctx,
    );
    expect(prm.status).toBe(200);
    expect(await prm.json()).toMatchObject({
      resource,
      authorization_servers: [tenantIssuer(TENANT)],
      scopes_supported: ["record:read"],
    });

    const pat = await issuePat(env.DB, {
      id: uuid(922),
      userId: USER,
      tenantId: TENANT,
      scopes: ["record:read"],
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });
    const okRes = await rs.fetch(
      new Request(resource, { method: "POST", headers: { authorization: `Bearer ${pat}` } }),
      env,
      ctx,
    );
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ user: USER, via: ["record:read"] });

    const stepUp = await rs.fetch(
      new Request(resource, { method: "DELETE", headers: { authorization: `Bearer ${pat}` } }),
      env,
      ctx,
    );
    expect(stepUp.status).toBe(403);
    expect(stepUp.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(stepUp.headers.get("www-authenticate")).toContain('scope="record:delete"');

    // 別テナントの PAT はこのテナントでは 401
    const foreign = await issuePat(env.DB, {
      id: uuid(923),
      userId: USER,
      tenantId: OTHER_TENANT,
      scopes: ["record:read"],
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });
    const wrongTenant = await rs.fetch(
      new Request(resource, { method: "POST", headers: { authorization: `Bearer ${foreign}` } }),
      env,
      ctx,
    );
    expect(wrongTenant.status).toBe(401);
  });
});

describe("M0-3 spike: 遅延計測(workerd ローカル)", () => {
  it("検証 1 回あたりの遅延を測る", async () => {
    const oauth = await authorize(createTenantAuthServer(TENANT), TENANT, ["record:read"]);
    const pat = await issuePat(env.DB, {
      id: uuid(924),
      userId: USER,
      tenantId: TENANT,
      scopes: ["record:read"],
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });
    const as = createTenantAuthServer(TENANT);
    await measure("construct AuthorizationServer", 50, async () => createTenantAuthServer(TENANT));
    await measure("oauth validateToken (KV + decrypt)", 50, () =>
      as.validateToken(tenantResource(TENANT), oauth.accessToken, env),
    );
    await measure("pat verify (D1 join)", 50, () => verifyPat(env.DB, TENANT, pat, NOW));
    await measure("gate oauth (validate + 2 KV)", 50, () =>
      authenticateMcpToken(env, TENANT, oauth.accessToken, NOW),
    );
    await measure("gate pat (D1 + 2 KV)", 50, () => authenticateMcpToken(env, TENANT, pat, NOW));
    await measure("authorize flow (code + PKCE + token)", 5, () =>
      authorize(createTenantAuthServer(TENANT), TENANT, ["record:read"]),
    );
    console.log("TIMINGS " + JSON.stringify(timings));
    expect(Object.keys(timings).length).toBe(6);
  });
});
