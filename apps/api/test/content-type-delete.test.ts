import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import {
  asDeleteContentTypeResult,
  asDeleteResult,
  asPublishResult,
  asRegisterResult,
  asWriteResult,
} from "./rpc-unwrap";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

async function generatedColumns(stub: ReturnType<typeof freshStub>): Promise<string[]> {
  return runInDurableObject(stub, async (_instance, state) =>
    state.storage.sql
      .exec<{ name: string }>("SELECT name FROM pragma_table_xinfo('records')")
      .toArray()
      .map((row) => row.name)
      .filter((name) => name.startsWith("g_article_")),
  );
}

async function writeArticle(stub: ReturnType<typeof freshStub>, recordId: string) {
  const written = asWriteResult(
    await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
  );
  expect(written.ok).toBe(true);
}

describe("deleteContentType (案 E 5.4)", () => {
  it("deletes a type without content and drops its generated index columns", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType(), auth("owner1"));
    expect(await generatedColumns(stub)).not.toStrictEqual([]);

    const result = asDeleteContentTypeResult(
      await stub.deleteContentType("article", auth("owner1")),
    );
    expect(result).toStrictEqual({ ok: true, key: "article" });
    expect(await stub.getContentType("article")).toBeNull();
    expect(await generatedColumns(stub)).toStrictEqual([]);
  });

  it("refuses while a live record exists, and allows it once only tombstones remain", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType(), auth("owner1"));
    await writeArticle(stub, uuid(10));
    expect(asPublishResult(await stub.publishRecord("t", "t", uuid(10), auth("owner1"))).ok).toBe(
      true,
    );

    const refused = asDeleteContentTypeResult(
      await stub.deleteContentType("article", auth("owner1")),
    );
    expect(refused).toMatchObject({ ok: false, code: "type_not_empty" });
    expect(await stub.getContentType("article")).not.toBeNull();

    // 削除(トゥームストーン化)すると公開版も取り下げられ、型を削除できる
    expect(asDeleteResult(await stub.deleteRecord(uuid(10), auth("owner1"))).ok).toBe(true);
    const deleted = asDeleteContentTypeResult(
      await stub.deleteContentType("article", auth("owner1")),
    );
    expect(deleted.ok).toBe(true);
    // トゥームストーンは同期の削除伝搬のために残る
    await runInDurableObject(stub, async (_instance, state) => {
      const row = state.storage.sql
        .exec<{ deleted_at: string | null }>(
          "SELECT deleted_at FROM records WHERE id = ?",
          uuid(10),
        )
        .one();
      expect(row.deleted_at).not.toBeNull();
    });
  });

  it("lets the same key be registered again with a new id after deletion", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType(), auth("owner1"));
    await stub.deleteContentType("article", auth("owner1"));
    const again = asRegisterResult(
      await stub.registerContentType({ ...articleType(), id: uuid(99) }, auth("owner1")),
    );
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.contentType.version).toBe(1);
    }
  });

  it("refuses system types, unknown keys and roles without type:manage", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType(), auth("owner1"));
    expect(
      asDeleteContentTypeResult(await stub.deleteContentType("asset", auth("owner1"))),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      asDeleteContentTypeResult(await stub.deleteContentType("nope", auth("owner1"))),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      asDeleteContentTypeResult(await stub.deleteContentType("article", auth("e1", "editor"))),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(await stub.getContentType("article")).not.toBeNull();
  });
});
