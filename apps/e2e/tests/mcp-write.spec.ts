import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  loginAsUser,
  openRecordEditor,
  provisionTenant,
  signupUser,
  superLogin,
} from "../helpers/setup";

// M4-6(design-spec 16.6・16.8・16.10・16.11): 書き込み MCP の E2E。テナントは自前(mcp-write)。
// 型の登録と PAT の発行は API で行い(UI の手順は mcp-smoke / core-journey が見ている)、MCP の書き込みが
// 管理画面に反映されること、管理画面の編集との競合、スコープ不足、確認できないクライアントの publish、
// 削除と復元を一通り確かめる。

const PROTOCOL = "2026-07-28";

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

async function call(
  request: APIRequestContext,
  endpoint: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
) {
  return request.post(endpoint, {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL,
      "mcp-method": "tools/call",
      "mcp-name": name,
      authorization: `Bearer ${token}`,
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": PROTOCOL,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
  });
}

async function tool(
  request: APIRequestContext,
  endpoint: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const res = await call(request, endpoint, token, name, args);
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { result?: ToolResult; error?: unknown };
  expect(body.error, JSON.stringify(body)).toBeUndefined();
  return body.result ?? {};
}

function uuidv7(): string {
  const hex = Date.now().toString(16).padStart(12, "0");
  const rand = crypto.randomUUID().replaceAll("-", "");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${rand.slice(0, 3)}-8${rand.slice(4, 7)}-${rand.slice(8, 20)}`;
}

test("MCP で書いた record が管理画面に出て、競合・ブロック編集・スコープ不足・確認不能・復元が通る", async ({
  page,
}) => {
  const email = `mcpw+${Date.now()}@example.com`;
  const password = "user-password-123";
  await signupUser(page.request, { email, password });
  await superLogin(page.request);
  await provisionTenant(page.request, { name: "MCP 書き込み", slug: "mcpw", ownerEmail: email });
  await loginAsUser(page, email, password);

  // テナント ID と JWT(セッション cookie から)
  const tenants = (await (await page.request.get("/auth/tenants")).json()) as {
    tenants: { id: string; slug: string }[];
  };
  const tenantId = tenants.tenants.find((t) => t.slug === "mcpw")?.id ?? "";
  expect(tenantId).not.toBe("");
  const issued = await page.request.post("/auth/token", { data: { tenantId } });
  expect(issued.status()).toBe(200);
  const jwt = ((await issued.json()) as { token: string }).token;
  const authz = { authorization: `Bearer ${jwt}` };

  // 本文(リッチテキスト)を持つ記事の型
  const registered = await page.request.put(`/v1/t/${tenantId}/content-types`, {
    headers: authz,
    data: {
      id: uuidv7(),
      key: "article",
      name: "記事",
      source: "user",
      version: 1,
      fields: [
        { key: "title", type: "text", required: true },
        { key: "body", type: "richtext" },
      ],
    },
  });
  expect(registered.status(), await registered.text()).toBe(200);

  const pat = async (scopes: string[]) => {
    const res = await page.request.post(`/v1/t/${tenantId}/tokens`, {
      headers: authz,
      data: { name: scopes.join(" "), scopes },
    });
    expect(res.status(), await res.text()).toBe(201);
    return ((await res.json()) as { token: string }).token;
  };
  const writer = await pat(["record:read", "record:write", "record:delete"]);
  const publisher = await pat(["record:read", "record:write", "record:publish"]);
  const endpoint = `/mcp/t/${tenantId}`;

  // 1. Markdown で作成 → 管理画面の一覧に出る
  const recordId = uuidv7();
  const title = "エージェントの記事";
  const created = await tool(page.request, endpoint, writer, "record_create", {
    type: "article",
    recordId,
    input: { title, body: "## 見出し\n\n最初の段落\n\n二番目の段落" },
  });
  expect(created.isError, JSON.stringify(created)).toBeUndefined();
  await page.goto("/");
  await page.getByRole("complementary").getByRole("link", { name: "記事", exact: true }).click();
  await expect(page.getByRole("rowheader", { name: title })).toBeVisible();

  // 2. エージェントが読んだ後に管理画面でタイトルを変える → 古い版での update は conflict
  const read = await tool(page.request, endpoint, writer, "record_get", { recordId });
  const staleVersions = read.structuredContent?.["fieldVersions"];
  await openRecordEditor(page, title);
  const edited = "人が直したタイトル";
  await page.getByRole("textbox", { name: "title" }).fill(edited);
  await page
    .getByRole("region", { name: "公開", exact: true })
    .getByRole("button", { name: "下書き保存" })
    .click();
  await expect
    .poll(async () => {
      const now = await tool(page.request, endpoint, writer, "record_get", { recordId });
      return (now.structuredContent?.["data"] as { title?: string } | undefined)?.title;
    })
    .toBe(edited);
  const conflict = await tool(page.request, endpoint, writer, "record_update", {
    recordId,
    input: { title: "エージェントの上書き" },
    baseFieldVersions: staleVersions,
  });
  expect(conflict.isError).toBe(true);
  expect(conflict.structuredContent).toMatchObject({ error: { code: "conflict" } });

  // 3. 読み直して、本文の 2 段落目だけをブロック操作で差し替える → 管理画面の本文に出る
  const fresh = await tool(page.request, endpoint, writer, "record_get", { recordId });
  const outlines = (fresh.structuredContent?.["outline"] ?? {}) as Record<
    string,
    { id: string; text: string }[]
  >;
  const outline = outlines["body"];
  const second = outline?.find((block) => block.text === "二番目の段落");
  expect(second).toBeDefined();
  const replaced = await tool(page.request, endpoint, writer, "record_update", {
    recordId,
    input: {
      body: { blocks: [{ op: "replace", id: second?.id, markdown: "差し替えた段落" }] },
    },
    baseFieldVersions: fresh.structuredContent?.["fieldVersions"],
  });
  expect(replaced.isError, JSON.stringify(replaced)).toBeUndefined();
  await page.reload();
  await expect(page.getByText("差し替えた段落")).toBeVisible();
  await expect(page.getByText("最初の段落")).toBeVisible();
  await expect(page.getByText("二番目の段落")).toHaveCount(0);

  // 4. record:publish の無い PAT は入口で 403 insufficient_scope
  const forbidden = await call(page.request, endpoint, writer, "record_publish", { recordId });
  expect(forbidden.status()).toBe(403);
  expect(forbidden.headers()["www-authenticate"] ?? "").toContain('scope="record:publish"');

  // 5. record:publish があっても、elicitation を宣言しないクライアントは確認できないので止まる(決定 50)
  const unavailable = await tool(page.request, endpoint, publisher, "record_publish", {
    recordId,
  });
  expect(unavailable.structuredContent).toMatchObject({
    error: { code: "confirmation_unavailable" },
  });

  // 6. 削除 → 履歴から復元
  const deleted = await tool(page.request, endpoint, writer, "record_delete", { recordId });
  expect(deleted.isError, JSON.stringify(deleted)).toBeUndefined();
  const history = await tool(page.request, endpoint, writer, "record_history", { recordId });
  const items = history.structuredContent?.["items"] as { historySeq: number; kind: string }[];
  const lastWrite = items.find((item) => item.kind === "write");
  const restored = await tool(page.request, endpoint, writer, "record_restore", {
    recordId,
    historySeq: lastWrite?.historySeq,
  });
  expect(restored.isError, JSON.stringify(restored)).toBeUndefined();
  await page.getByRole("complementary").getByRole("link", { name: "記事", exact: true }).click();
  await expect(page.getByRole("rowheader", { name: edited })).toBeVisible();
});
