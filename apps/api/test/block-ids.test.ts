import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { BLOCK_ID_ATTR, type RichTextEnvelope } from "@plyrs/metamodel";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asInvokeResult, asWriteResult } from "./rpc-unwrap";

// M2-1(決定 44・46): v1 のリッチテキストは書き込み時に版 2 として最上位ブロックの ID を永続化し、
// 読み取り(record_get)では保存行を変えずに決定的な ID を導出して返す。

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

const para = (text: string, attrs?: Record<string, string>) => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content: [{ type: "text", text }],
});

function v1Body(): RichTextEnvelope {
  return { schemaVersion: 1, doc: { type: "doc", content: [para("a"), para("b")] } };
}

function blockIds(envelope: unknown): unknown[] {
  return ((envelope as RichTextEnvelope).doc.content ?? []).map((b) => b.attrs?.[BLOCK_ID_ATTR]);
}

describe("最上位ブロックの安定 ID(M2-1)", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
  });

  it("v1 の本文を書くと版 2・全最上位ブロックに ID が付いて保存される", async () => {
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(50), input: { ...validArticleInput(), body: v1Body() } },
        auth("a"),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.record.data["body"] as RichTextEnvelope;
    expect(body.schemaVersion).toBe(2);
    expect(blockIds(body)).toHaveLength(2);
    for (const id of blockIds(body)) {
      expect(id).toMatch(/^v1-[0-9a-f]{24}$/);
    }
    await runInDurableObject(stub, async (_instance, state) => {
      const row = state.storage.sql
        .exec<{ data: string }>("SELECT data FROM records WHERE id = ?", uuid(50))
        .one();
      const stored = JSON.parse(row.data) as Record<string, unknown>;
      expect((stored["body"] as RichTextEnvelope).schemaVersion).toBe(2);
    });
  });

  it("同じ v1 の本文を 2 回書くと 2 回目は無変更(applied: false)", async () => {
    const input = { ...validArticleInput(), body: v1Body() };
    await stub.writeRecord("article", { recordId: uuid(51), input }, auth("a"));
    const second = asWriteResult(
      await stub.writeRecord("article", { recordId: uuid(51), input }, auth("a")),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.applied).toBe(false);
    expect(second.record.version).toBe(1);
  });

  it("v1 のまま保存されている record を record_get すると導出 ID が返り、保存行は変わらない", async () => {
    await stub.writeRecord(
      "article",
      { recordId: uuid(52), input: validArticleInput() },
      auth("a"),
    );
    // 書き込み経路を通さず v1 の本文を直接保存する(M2-1 以前に書かれた record の再現)
    await runInDurableObject(stub, async (_instance, state) => {
      const row = state.storage.sql
        .exec<{ data: string }>("SELECT data FROM records WHERE id = ?", uuid(52))
        .one();
      const data = JSON.parse(row.data) as Record<string, unknown>;
      data["body"] = v1Body();
      state.storage.sql.exec(
        "UPDATE records SET data = ? WHERE id = ?",
        JSON.stringify(data),
        uuid(52),
      );
    });
    const first = asInvokeResult(
      await stub.invoke("record_get", { recordId: uuid(52) }, auth("a")),
    );
    const second = asInvokeResult(
      await stub.invoke("record_get", { recordId: uuid(52) }, auth("a")),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const body1 = (first.output as { data: Record<string, unknown> }).data["body"];
    const body2 = (second.output as { data: Record<string, unknown> }).data["body"];
    expect((body1 as RichTextEnvelope).schemaVersion).toBe(2);
    expect(blockIds(body1)).toEqual(blockIds(body2));
    expect(blockIds(body1)[0]).toMatch(/^v1-/);
    await runInDurableObject(stub, async (_instance, state) => {
      const row = state.storage.sql
        .exec<{ data: string }>("SELECT data FROM records WHERE id = ?", uuid(52))
        .one();
      const stored = JSON.parse(row.data) as Record<string, unknown>;
      expect((stored["body"] as RichTextEnvelope).schemaVersion).toBe(1);
    });
  });

  it("重複した ID を含む入力は 2 つ目が振り直されて保存される", async () => {
    const body: RichTextEnvelope = {
      schemaVersion: 2,
      doc: { type: "doc", content: [para("a", { id: "dup" }), para("b", { id: "dup" })] },
    };
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(53), input: { ...validArticleInput(), body } },
        auth("a"),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = blockIds(result.record.data["body"]);
    expect(ids[0]).toBe("dup");
    expect(ids[1]).not.toBe("dup");
  });
});
