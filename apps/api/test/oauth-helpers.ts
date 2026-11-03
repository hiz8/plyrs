import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import type { Role } from "../src/auth/permissions";
import { app } from "../src/index";
import { createTenantAuthServer, tenantIssuer, tenantResource } from "../src/oauth/server";

// M3(決定 47〜49)のテストで共有する: テナントと会員の用意、PKCE、認可コード + PKCE の一巡。
// 認可サーバーの issuer は admin のオリジン(ADMIN_ORIGIN)、resource は api のオリジン(API_ORIGIN)で、
// wrangler.jsonc のトップレベル(dev 用 localhost)ではなく、テストごとに env を上書きして渡す。

export const ADMIN_ORIGIN = "https://admin.example";
export const API_ORIGIN = "https://api.example";
export const REDIRECT_URI = "http://localhost:3333/callback";
// app.request は ExecutionContext を渡さないとライブラリが 500 になる
export const CTX = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

export function oauthEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, ADMIN_ORIGIN, API_ORIGIN, ...overrides };
}

export async function insertMember(
  tenantId: string,
  role: Role,
): Promise<{ userId: string; email: string }> {
  const userId = crypto.randomUUID();
  const email = `${userId}@example.com`;
  const now = new Date().toISOString();
  const db = drizzle(env.DB);
  await db.insert(users).values({ id: userId, email, passwordHash: "h", createdAt: now });
  await db.insert(memberships).values({ userId, tenantId, role, createdAt: now });
  return { userId, email };
}

export async function insertTenant(name = "OAuth"): Promise<string> {
  const id = crypto.randomUUID();
  await drizzle(env.DB)
    .insert(tenants)
    .values({ id, slug: `s-${id}`, name, createdAt: new Date().toISOString() });
  return id;
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

// DCR(/oauth/register)で公開クライアントを作る
export async function registerClient(tenantId: string, testEnv: Env = oauthEnv()): Promise<string> {
  const res = await app.request(
    `${tenantIssuer(ADMIN_ORIGIN, tenantId)}/oauth/register`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [REDIRECT_URI],
        client_name: "test client",
        token_endpoint_auth_method: "none",
      }),
    },
    testEnv,
    CTX,
  );
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json<{ client_id: string }>();
  return body.client_id;
}

export function authorizeUrl(
  tenantId: string,
  clientId: string,
  scope: readonly string[],
  challenge: string,
  overrides: Record<string, string> = {},
): URL {
  const url = new URL(`${tenantIssuer(ADMIN_ORIGIN, tenantId)}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", scope.join(" "));
  url.searchParams.set("state", "st");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", tenantResource(API_ORIGIN, tenantId));
  for (const [key, value] of Object.entries(overrides)) {
    url.searchParams.set(key, value);
  }
  return url;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  [key: string]: unknown;
}

export async function tokenRequest(
  tenantId: string,
  params: Record<string, string>,
  testEnv: Env = oauthEnv(),
): Promise<Response> {
  return app.request(
    `${tenantIssuer(ADMIN_ORIGIN, tenantId)}/oauth/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    },
    testEnv,
    CTX,
  );
}

export interface Issued extends TokenResponse {
  clientId: string;
  userId: string;
}

// 認可コード + PKCE の一巡。同意画面(M3-2)を通さず、ライブラリのヘルパーで直接グラントを作る
// (同意画面のテストは oauth-consent.test.ts)
export async function authorize(
  tenantId: string,
  scope: readonly string[],
  options: { userId?: string; role?: Role; env?: Env } = {},
): Promise<Issued> {
  const testEnv = options.env ?? oauthEnv();
  const role = options.role ?? "editor";
  const userId = options.userId ?? (await insertMember(tenantId, role)).userId;
  const clientId = await registerClient(tenantId, testEnv);
  const { verifier, challenge } = await pkce();
  const server = createTenantAuthServer(testEnv, tenantId);
  if (server === null) {
    throw new Error("auth server not configured");
  }
  const oauth = server.getOAuthApi(testEnv);
  const request = await oauth.parseAuthRequest(
    new Request(authorizeUrl(tenantId, clientId, scope, challenge)),
  );
  const { redirectTo } = await oauth.completeAuthorization({
    request,
    userId,
    metadata: { tenantId },
    scope: request.scope,
    props: { userId, tenantId, role },
  });
  const code = new URL(redirectTo).searchParams.get("code");
  if (code === null) {
    throw new Error("no code in redirect");
  }
  const res = await tokenRequest(
    tenantId,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource: tenantResource(API_ORIGIN, tenantId),
    },
    testEnv,
  );
  const body = await res.json<TokenResponse>();
  if (res.status !== 200) {
    throw new Error(`token failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return { ...body, clientId, userId };
}
