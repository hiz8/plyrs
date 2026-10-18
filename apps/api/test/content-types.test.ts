import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { loadAllContentTypes } from "../src/sync/records";
import { articleType, auth, uuid } from "./fixtures";
import { asContentTypeRows } from "./rpc-unwrap";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("content type registration", () => {
  it("registers a valid user type with server-managed version 1", async () => {
    const stub = freshStub();
    const result = await stub.registerContentType(articleType(), auth("admin"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType.version).toBe(1);
      expect(result.contentType.key).toBe("article");
    }
  });

  it("persists the row and returns parsed fields via getContentType", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
    const row = await stub.getContentType("article");
    expect(row?.name).toBe("記事");
    expect(row?.fields.map((f) => f.key)).toContain("slug");
    await runInDurableObject(stub, async (_instance, state) => {
      // Phase 8 裁定 2: システム asset 型も自動登録されており content_types は単一行ではない
      const stored = state.storage.sql
        .exec<{ key: string; version: number }>(
          "SELECT key, version FROM content_types WHERE key = 'article'",
        )
        .one();
      expect(stored).toEqual({ key: "article", version: 1 });
    });
  });

  it("bumps the version when re-registering the same type (same id)", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
    const next = articleType();
    next.name = "記事（改）";
    const result = await stub.registerContentType(next, auth("admin"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType.version).toBe(2);
      expect(result.contentType.name).toBe("記事（改）");
    }
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql
        .exec<{ version: number; name: string }>(
          "SELECT version, name FROM content_types WHERE key = 'article'",
        )
        .one();
      expect(stored).toEqual({ version: 2, name: "記事（改）" });
    });
  });

  it("rejects a re-register under the same key with a different id", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
    const impostor = { ...articleType(), id: uuid(99) };
    const result = await stub.registerContentType(impostor, auth("admin"));
    expect(result).toMatchObject({ ok: false, code: "id_mismatch" });
  });

  it("rejects an invalid definition (duplicate field keys)", async () => {
    const stub = freshStub();
    const bad = articleType();
    bad.fields = [
      { key: "title", type: "text" },
      { key: "title", type: "number" },
    ];
    const result = await stub.registerContentType(bad, auth("admin"));
    expect(result).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("rejects re-registering the same id under a different key without throwing", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
    const renamed = { ...articleType(), key: "post" };
    const result = await stub.registerContentType(renamed, auth("admin"));
    expect(result).toMatchObject({ ok: false, code: "key_mismatch" });
    expect(await stub.getContentType("article")).not.toBeNull();
    expect(await stub.getContentType("post")).toBeNull();
  });

  // Phase 9(§4.1): プラグイン名前空間はモジュールシステム専有。クライアント経由の
  // registerContentType RPC は allowPlugin を渡さないため source='plugin' を forbidden で拒否する
  // (以前はここで受理していたが、モジュール有効化時の固定 ID との衝突を防ぐため閉じた)。
  it("rejects a namespaced plugin type via the client RPC", async () => {
    const stub = freshStub();
    const pluginType = {
      ...articleType(),
      id: uuid(5),
      key: "booking.slot",
      source: "plugin" as const,
      pluginId: "booking",
    };
    const result = await stub.registerContentType(pluginType, auth("admin"));
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    expect(await stub.getContentType("no_such_type")).toBeNull();
  });

  it("lists all content types ordered by key (Phase 6a)", async () => {
    const stub = freshStub();
    await stub.registerContentType(
      {
        id: uuid(9),
        key: "author",
        name: "著者",
        source: "user",
        version: 1,
        fields: [{ key: "name", type: "text", required: true }],
      },
      auth("admin"),
    );
    await stub.registerContentType(articleType(), auth("admin"));
    const rows = asContentTypeRows(await stub.listContentTypes());
    // Phase 8 裁定 2: システム asset 型が key 昇順で article と author の間に自動登録される
    expect(rows.map((row) => row.key)).toStrictEqual(["article", "asset", "author"]);
    expect(rows[0]?.fields.some((field) => field.key === "title")).toBe(true);
    expect(rows[2]?.name).toBe("著者");
  });
});

function displayType() {
  const def = articleType();
  return {
    ...def,
    fields: def.fields.map((field) =>
      field.key === "title" ? { ...field, label: "タイトル", description: "一覧に表示" } : field,
    ),
    description: "ブログの記事",
    titleField: "slug",
    listColumns: ["published_at"],
    menuOrder: 3,
  };
}

describe("display metadata (案 E 2 章)", () => {
  it("persists type and field display items and returns them from getContentType", async () => {
    const stub = freshStub();
    const result = await stub.registerContentType(displayType(), auth("admin"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toMatchObject({
        description: "ブログの記事",
        titleField: "slug",
        listColumns: ["published_at"],
        menuOrder: 3,
      });
    }
    const row = await stub.getContentType("article");
    expect(row).toMatchObject({
      description: "ブログの記事",
      titleField: "slug",
      listColumns: ["published_at"],
      menuOrder: 3,
    });
    expect(row?.fields.find((f) => f.key === "title")).toMatchObject({
      label: "タイトル",
      description: "一覧に表示",
    });
  });

  it("returns null for unset items on existing-style definitions", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
    const row = await stub.getContentType("article");
    expect(row).toMatchObject({
      description: null,
      titleField: null,
      listColumns: null,
      menuOrder: null,
    });
  });

  it("treats an identical re-register as a no-op and bumps the version on display changes", async () => {
    const stub = freshStub();
    await stub.registerContentType(displayType(), auth("admin"));
    const same = await stub.registerContentType(displayType(), auth("admin"));
    expect(same.ok && same.applied).toBe(false);

    const reordered = await stub.registerContentType(
      { ...displayType(), menuOrder: 1 },
      auth("admin"),
    );
    expect(reordered.ok && reordered.applied).toBe(true);
    if (reordered.ok) {
      expect(reordered.contentType.version).toBe(2);
    }

    // 項目を省くと未指定(NULL)に戻る
    const { description: _description, ...withoutDescription } = displayType();
    const cleared = await stub.registerContentType(
      { ...withoutDescription, menuOrder: 1 },
      auth("admin"),
    );
    expect(cleared.ok && cleared.applied).toBe(true);
    expect((await stub.getContentType("article"))?.description).toBeNull();
  });

  it("rejects a titleField that does not point to a text field", async () => {
    const stub = freshStub();
    const result = await stub.registerContentType(
      { ...articleType(), titleField: "published_at" },
      auth("admin"),
    );
    expect(result).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("delivers display items to sync clients via the content type definitions", async () => {
    const stub = freshStub();
    await stub.registerContentType(displayType(), auth("admin"));
    await runInDurableObject(stub, async (_instance, state) => {
      const article = loadAllContentTypes(state.storage.sql).find((t) => t.key === "article");
      expect(article).toMatchObject({
        description: "ブログの記事",
        titleField: "slug",
        listColumns: ["published_at"],
        menuOrder: 3,
      });
      // 未指定の項目はキーごと無い(asset はシステム型で表示項目を持たない)
      const asset = loadAllContentTypes(state.storage.sql).find((t) => t.key === "asset");
      expect(asset).not.toHaveProperty("titleField");
    });
  });
});
