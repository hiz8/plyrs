import { expect, test, type APIRequestContext } from "@playwright/test";
import { loginAsUser, provisionTenant, signupUser, superLogin } from "../helpers/setup";

// M5c(design-spec 16.8、決定 57): 提案(change set)の E2E。テナントは自前(props)。
// record:propose だけの PAT が record_update で止められて proposal_create へ導かれ、提案を管理画面で
// 採用すると採用した人の名前で書き込まれること、却下が理由とともに proposal_get で読めることを確かめる。

const PROTOCOL = "2026-07-28";

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

async function tool(
  request: APIRequestContext,
  endpoint: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const res = await request.post(endpoint, {
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

test("record:propose の PAT の提案を管理画面で採用・却下できる", async ({ page }) => {
  const email = `props+${Date.now()}@example.com`;
  const password = "user-password-123";
  await signupUser(page.request, { email, password });
  await superLogin(page.request);
  await provisionTenant(page.request, { name: "提案", slug: "props", ownerEmail: email });
  await loginAsUser(page, email, password);

  const tenants = (await (await page.request.get("/auth/tenants")).json()) as {
    tenants: { id: string; slug: string }[];
  };
  const tenantId = tenants.tenants.find((t) => t.slug === "props")?.id ?? "";
  expect(tenantId).not.toBe("");
  const issued = await page.request.post("/auth/token", { data: { tenantId } });
  expect(issued.status()).toBe(200);
  const jwt = ((await issued.json()) as { token: string }).token;
  const authz = { authorization: `Bearer ${jwt}` };

  // 1. owner が API で型と record を作る
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
  const recordId = uuidv7();
  const originalTitle = "元のタイトル";
  const createdByOwner = await page.request.post(`/v1/t/${tenantId}/ops/record_create`, {
    headers: authz,
    data: { type: "article", recordId, input: { title: originalTitle, body: "本文" } },
  });
  expect(createdByOwner.status(), await createdByOwner.text()).toBe(200);

  const patRes = await page.request.post(`/v1/t/${tenantId}/tokens`, {
    headers: authz,
    data: { name: "proposer", scopes: ["record:read", "record:propose"] },
  });
  expect(patRes.status(), await patRes.text()).toBe(201);
  const proposer = ((await patRes.json()) as { token: string }).token;
  const endpoint = `/mcp/t/${tenantId}`;

  // 2. record:write の無い PAT は record_update で止められ、proposal_create を案内される(決定 57)
  const denied = await tool(page.request, endpoint, proposer, "record_update", {
    recordId,
    input: { title: "x" },
    baseFieldVersions: {},
  });
  expect(denied.isError).toBe(true);
  expect(denied.structuredContent).toMatchObject({
    error: {
      code: "insufficient_scope",
      details: { required: "record:write", tokenKind: "pat", alternative: "proposal_create" },
    },
  });

  // 3. 同じ PAT で更新を提案する
  const proposalId = uuidv7();
  const proposedTitle = "提案されたタイトル";
  const created = await tool(page.request, endpoint, proposer, "proposal_create", {
    proposalId,
    kind: "update",
    recordId,
    input: { title: proposedTitle, body: "## 見出し\n\n提案した本文" },
    note: "見出しを足しました",
  });
  expect(created.isError, JSON.stringify(created)).toBeUndefined();
  expect(created.structuredContent).toMatchObject({ id: proposalId, state: "open" });

  // 4. 管理画面: サイドバーの「提案」に件数が出る → 一覧 → 詳細の差分 → 採用
  await page.goto("/");
  const navLink = page.getByRole("complementary").getByRole("link", { name: /提案/ });
  await expect(navLink).toContainText("1");
  await navLink.click();
  const list = page.getByRole("list", { name: "提案の一覧" });
  const row = list.getByRole("link").first();
  await expect(row).toContainText(originalTitle);
  await expect(row).toContainText("更新");
  await row.click();
  const diff = page.getByRole("region", { name: "現在との差分" });
  await expect(diff.getByRole("row", { name: /title/ })).toContainText(originalTitle);
  await expect(diff.getByRole("row", { name: /title/ })).toContainText(proposedTitle);
  await expect(page.getByText("見出しを足しました")).toBeVisible();
  await page.getByRole("button", { name: "採用する" }).click();
  const acceptDialog = page.getByRole("dialog", { name: "更新の提案を採用しますか？" });
  await acceptDialog.getByRole("button", { name: "採用する" }).click();
  const toasts = page.getByRole("region", { name: "通知" });
  await expect(toasts.getByText("採用しました")).toBeVisible();
  await expect(page.getByText("未処理の提案はありません")).toBeVisible();

  // 5. 採用の結果: record が提案の値になり、履歴の先頭は採用した人の版で proposalId を持つ
  const read = await tool(page.request, endpoint, proposer, "record_get", { recordId });
  const data = read.structuredContent?.["data"] as { title?: string } | undefined;
  expect(data?.title).toBe(proposedTitle);
  const history = await tool(page.request, endpoint, proposer, "record_history", { recordId });
  const items = history.structuredContent?.["items"] as
    | { via: string; proposalId: string | null }[]
    | undefined;
  const latest = items?.[0];
  expect(latest).toMatchObject({ via: "rest", proposalId });

  // 6. 公開の提案を却下する(理由つき)→ proposal_get で rejected と理由が読める
  const publishProposal = uuidv7();
  const proposedPublish = await tool(page.request, endpoint, proposer, "proposal_create", {
    proposalId: publishProposal,
    kind: "publish",
    recordId,
  });
  expect(proposedPublish.isError, JSON.stringify(proposedPublish)).toBeUndefined();
  await page.reload();
  await page.getByRole("list", { name: "提案の一覧" }).getByRole("link").first().click();
  await page.getByRole("button", { name: "却下する" }).click();
  const rejectDialog = page.getByRole("alertdialog", { name: "却下しますか？" });
  await rejectDialog.getByRole("textbox", { name: "理由(任意)" }).fill("まだ公開しない");
  await rejectDialog.getByRole("button", { name: "却下する" }).click();
  await expect(toasts.getByText("却下しました")).toBeVisible();
  const rejected = await tool(page.request, endpoint, proposer, "proposal_get", {
    proposalId: publishProposal,
  });
  expect(rejected.structuredContent).toMatchObject({
    state: "rejected",
    resolutionNote: "まだ公開しない",
  });
});
