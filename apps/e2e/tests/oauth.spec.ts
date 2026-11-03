import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { provisionTenant, signupUser, superLogin } from "../helpers/setup";

// M3(design-spec 16.2・16.3、決定 47〜49)の OAuth の一巡。playwright.config.ts の projects/dependencies により
// core-journey の後に実行される。テナント(oauth)とユーザーは自前で作る。
// DCR で公開クライアントを登録 → 未ログインで /authorize に入ると /login?return_to= に回る → ログイン後に
// 同意画面へ戻り「許可する」→ callback の code を PKCE で token に交換 → MCP の入口で tools/list。
// スコープ不足(record:write だけ)の token で tools/call を呼ぶと 403 insufficient_scope になり、
// record:read を含めて再認可(step-up)すると通る。管理画面の 設定 › 接続中のアプリ に付与が並び、失効すると
// 同じ token が 401 になる。CIMD はローカルの URL を取りに行けない(global_fetch_strictly_public)ので DCR だけ。
// dev では admin の dev サーバーが /oauth・/.well-known・/mcp を api へ転送し(DEV_PROXY_PUBLIC=1)、
// api の .dev.vars の ADMIN_ORIGIN / API_ORIGIN は http://localhost:5199(global-setup.ts が書く)。

const PROTOCOL = "2026-07-28";
const CALLBACK = "http://localhost:3999/callback";

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function registerClient(
  request: APIRequestContext,
  tenantId: string,
  name: string,
): Promise<string> {
  const res = await request.post(`/oauth/t/${tenantId}/oauth/register`, {
    data: { redirect_uris: [CALLBACK], client_name: name, token_endpoint_auth_method: "none" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

function authorizeUrl(tenantId: string, clientId: string, scope: string, challenge: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK,
    scope,
    state: "s1",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `/oauth/t/${tenantId}/authorize?${params}`;
}

// 同意画面で「許可する」を押し、callback の URL から code を取る(callback は本物の HTTP サーバー。
// 同意の POST → 302 の先は page.route では差し替えられない)
async function approveAndTakeCode(page: Page): Promise<string> {
  await expect(page.getByRole("heading", { name: /への接続を求めています/ })).toBeVisible();
  await page.getByRole("button", { name: "許可する" }).click();
  await page.waitForURL(/localhost:3999\/callback\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get("state")).toBe("s1");
  const code = url.searchParams.get("code");
  expect(code).not.toBeNull();
  return code ?? "";
}

async function exchange(
  request: APIRequestContext,
  tenantId: string,
  clientId: string,
  code: string,
  verifier: string,
): Promise<string> {
  const res = await request.post(`/oauth/t/${tenantId}/oauth/token`, {
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: CALLBACK,
      client_id: clientId,
      code_verifier: verifier,
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function rpc(
  request: APIRequestContext,
  tenantId: string,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
) {
  return request.post(`/mcp/t/${tenantId}`, {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL,
      "mcp-method": method,
      ...(typeof params["name"] === "string" ? { "mcp-name": params["name"] } : {}),
      authorization: `Bearer ${token}`,
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": PROTOCOL,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
  });
}

test("OAuth で同意して MCP に接続し、スコープ不足は再認可で通り、管理画面から失効できる", async ({
  page,
  request,
}) => {
  // request(API 用の context)は page とは cookie を共有しない。page は未ログインのまま始める
  const email = `oauth+${Date.now()}@example.com`;
  const password = "user-password-123";
  await signupUser(request, { email, password });
  await superLogin(request);
  await provisionTenant(request, { name: "OAuth", slug: "oauth", ownerEmail: email });
  const login = await request.post("/auth/login", { data: { email, password } });
  expect(login.ok(), await login.text()).toBe(true);
  const tenants = (await (await request.get("/auth/tenants")).json()) as {
    tenants: { id: string; slug: string }[];
  };
  const tenantId = tenants.tenants.find((t) => t.slug === "oauth")?.id ?? "";
  expect(tenantId).not.toBe("");

  // Authorization Server Metadata はテナント別 issuer(admin のオリジン)配下にある
  const meta = await request.get(`/.well-known/oauth-authorization-server/oauth/t/${tenantId}`);
  expect(meta.status()).toBe(200);
  expect(((await meta.json()) as { issuer: string }).issuer).toBe(
    `http://localhost:5199/oauth/t/${tenantId}`,
  );

  // callback(クライアント側の受け口)を 3999 で待ち受ける(本物の MCP クライアントの loopback と同じ)
  const callback: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body>ok</body></html>");
  });
  await new Promise<void>((resolve) => callback.listen(3999, "127.0.0.1", resolve));
  try {
    await flow(page, request, tenantId, email, password);
  } finally {
    await new Promise<void>((resolve) => callback.close(() => resolve()));
  }
});

async function flow(
  page: Page,
  request: APIRequestContext,
  tenantId: string,
  email: string,
  password: string,
): Promise<void> {
  // 1 回目: record:write だけを求める。未ログインなので /login?return_to= に回り、ログイン後に同意画面へ戻る
  const writeClient = await registerClient(request, tenantId, "e2e-write");
  const first = pkce();
  await page.goto(authorizeUrl(tenantId, writeClient, "record:write", first.challenge));
  await page.waitForURL(/\/login\?return_to=/);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
  const writeToken = await exchange(
    request,
    tenantId,
    writeClient,
    await approveAndTakeCode(page),
    first.verifier,
  );

  // record:write だけの token: tools/list は通るが、record:read を要する tools/call は 403 insufficient_scope
  expect((await rpc(request, tenantId, writeToken, "tools/list")).status()).toBe(200);
  const denied = await rpc(request, tenantId, writeToken, "tools/call", {
    name: "type_list",
    arguments: {},
  });
  expect(denied.status()).toBe(403);
  expect(denied.headers()["www-authenticate"] ?? "").toContain('error="insufficient_scope"');
  expect(denied.headers()["www-authenticate"] ?? "").toContain('scope="record:read"');

  // 2 回目(step-up): record:read を含めて再認可する。ログイン済みなので同意画面に直接着く
  const readClient = await registerClient(request, tenantId, "e2e-read");
  const second = pkce();
  await page.goto(authorizeUrl(tenantId, readClient, "record:read", second.challenge));
  const readToken = await exchange(
    request,
    tenantId,
    readClient,
    await approveAndTakeCode(page),
    second.verifier,
  );
  const listed = await rpc(request, tenantId, readToken, "tools/call", {
    name: "type_list",
    arguments: {},
  });
  expect(listed.status(), await listed.text()).toBe(200);

  // 管理画面の 設定 › 接続中のアプリ に 2 つの付与が並ぶ。read の方を失効させると、その token は 401
  await page.goto(`/t/oauth/settings/tokens`);
  await expect(page.getByRole("rowheader", { name: /e2e-write/ })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: /e2e-read/ })).toBeVisible();
  await page.getByRole("button", { name: "e2e-readを失効" }).click();
  await page.getByRole("button", { name: "失効する" }).click();
  await expect(page.getByRole("rowheader", { name: /e2e-read/ })).toHaveCount(0);
  await expect(page.getByRole("rowheader", { name: /e2e-write/ })).toBeVisible();
  expect((await rpc(request, tenantId, readToken, "tools/list")).status()).toBe(401);
  expect((await rpc(request, tenantId, writeToken, "tools/list")).status()).toBe(200);
}
