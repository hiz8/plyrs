import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { McpAuth } from "../src/do/authorize";
import { OPERATIONS } from "../src/ops/catalog";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asInvokeResult, asWriteResult } from "./rpc-unwrap";

// M1-1(design-spec 16.4): 操作カタログと DO の invoke RPC。実効権限 = スコープ ∩ ロールを
// DO の中で判定する(Review Focus 1: Worker を迂回して invoke を呼んでも抜けない)。

const TENANT = uuid(700);
const RECORD = uuid(701);
const DELETED = uuid(702);

function stubFor(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function mcpAuth(overrides: Partial<McpAuth> = {}): McpAuth {
  return {
    userId: "agent",
    role: "viewer",
    tenantId: TENANT,
    exp: Math.floor(Date.now() / 1000) + 3600,
    scopes: ["record:read"],
    tokenId: uuid(710),
    tokenKind: "pat",
    ...overrides,
  };
}

const stub = stubFor(TENANT);

beforeAll(async () => {
  const owner = { ...auth("owner", "owner"), tenantId: TENANT };
  expect((await stub.registerContentType(articleType(), owner)).ok).toBe(true);
  const written = asWriteResult(
    await stub.writeRecord("article", { recordId: RECORD, input: validArticleInput() }, owner),
  );
  expect(written.ok).toBe(true);
  const doomed = asWriteResult(
    await stub.writeRecord(
      "article",
      { recordId: DELETED, input: { ...validArticleInput(), slug: "doomed" } },
      owner,
    ),
  );
  expect(doomed.ok).toBe(true);
  expect((await stub.deleteRecord(DELETED, owner)).ok).toBe(true);
});

describe("操作カタログ", () => {
  it("読み取り 4・検索 1・履歴 3・書き込み 5・アセット 2 の操作を宣言順に持ち、MCP に出す書き込みは段階的に増やす(M4)", () => {
    expect(OPERATIONS.map((op) => op.name)).toEqual([
      "type_list",
      "type_get",
      "record_list",
      "record_get",
      "record_search",
      "record_history",
      "record_compare",
      "record_restore",
      "record_create",
      "record_update",
      "record_delete",
      "record_publish",
      "record_unpublish",
      "asset_upload",
      "asset_import_url",
    ]);
    // M4-1b: create / update / delete、M4-3: restore、M4-2: publish / unpublish
    expect(
      OPERATIONS.filter((op) => op.via.includes("mcp") && !op.hints.readOnly).map((op) => op.name),
    ).toEqual([
      "record_restore",
      "record_create",
      "record_update",
      "record_delete",
      "record_publish",
      "record_unpublish",
      "asset_upload",
      "asset_import_url",
    ]);
  });
});

describe("invoke RPC", () => {
  it("Worker で実行する操作(asset_upload)を DO の invoke で呼ぶと unknown_operation", async () => {
    const result = asInvokeResult(
      await stub.invoke(
        "asset_upload",
        { filename: "a.png", contentType: "image/png" },
        { ...auth("o", "owner"), tenantId: TENANT },
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "unknown_operation" });
  });

  it("同期・REST の経路(scopes 無し)の viewer は record_get が通る", async () => {
    const result = asInvokeResult(
      await stub.invoke(
        "record_get",
        { recordId: RECORD },
        { ...auth("v", "viewer"), tenantId: TENANT },
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toMatchObject({ id: RECORD, type: "article", status: "draft" });
    }
  });

  it("scopes: [] は insufficient_scope", async () => {
    const result = asInvokeResult(
      await stub.invoke("record_get", { recordId: RECORD }, mcpAuth({ scopes: [] })),
    );
    expect(result).toMatchObject({ ok: false, code: "insufficient_scope" });
  });

  it("scopes: [record:read] + viewer は通る", async () => {
    const result = asInvokeResult(await stub.invoke("record_get", { recordId: RECORD }, mcpAuth()));
    expect(result.ok).toBe(true);
  });

  it("スコープは権限を増やさない: record:write だけの owner でも record_get は insufficient_scope", async () => {
    const result = asInvokeResult(
      await stub.invoke(
        "record_get",
        { recordId: RECORD },
        mcpAuth({ role: "owner", scopes: ["record:write"] }),
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "insufficient_scope" });
  });

  it("未知の操作名は unknown_operation", async () => {
    const result = asInvokeResult(await stub.invoke("record_explode", {}, mcpAuth()));
    expect(result).toMatchObject({ ok: false, code: "unknown_operation" });
  });

  it("Zod に合わない入力は invalid_input と issues", async () => {
    const result = asInvokeResult(
      await stub.invoke("record_get", { recordId: "not-a-uuid" }, mcpAuth()),
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
    if (!result.ok) {
      expect(result.issues).toBeDefined();
    }
  });

  it("削除済み record と存在しない record は not_found", async () => {
    expect(
      asInvokeResult(await stub.invoke("record_get", { recordId: DELETED }, mcpAuth())),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      asInvokeResult(await stub.invoke("record_get", { recordId: uuid(799) }, mcpAuth())),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  it("type_list は定義と version・updatedAt を返し、type_get は key で引く", async () => {
    const list = asInvokeResult(await stub.invoke("type_list", {}, mcpAuth()));
    expect(list.ok).toBe(true);
    if (list.ok) {
      const types = (
        list.output as { types: { key: string; version: number; updatedAt: string }[] }
      ).types;
      const article = types.find((t) => t.key === "article");
      expect(article).toMatchObject({ key: "article", version: 1 });
      expect(typeof article?.updatedAt).toBe("string");
    }
    const got = asInvokeResult(await stub.invoke("type_get", { key: "article" }, mcpAuth()));
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.output).toMatchObject({ key: "article", name: "記事" });
    }
    expect(asInvokeResult(await stub.invoke("type_get", { key: "nope" }, mcpAuth()))).toMatchObject(
      {
        ok: false,
        code: "not_found",
      },
    );
  });

  it("別テナント向けの認可コンテキストは DO 側でも forbidden(URL と auth.tenantId の照合)", async () => {
    const result = asInvokeResult(
      await stub.invoke("record_get", { recordId: RECORD }, mcpAuth({ tenantId: uuid(777) })),
    );
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });
});
