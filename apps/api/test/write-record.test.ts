import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asRecordSnapshot, asWriteResult } from "./rpc-unwrap";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

function mentionBody(refs: Array<{ type: string; id: string }>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: refs.flatMap((ref) => [
            {
              type: "recordMention",
              attrs: { recordType: ref.type, recordId: ref.id, label: "参照" },
            },
            { type: "text", text: " " },
          ]),
        },
      ],
    },
  };
}

describe("writeRecord", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    const registered = await stub.registerContentType(articleType(), auth("admin"));
    expect(registered.ok).toBe(true);
  });

  it("creates a record with bookkeeping columns and reprojected relations", async () => {
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        {
          recordId: uuid(10),
          input: validArticleInput(),
        },
        auth("user-a"),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.record.version).toBe(1);
    expect(result.record.seq).toBe(1);
    expect(result.record.status).toBe("draft");
    expect(result.record.fieldVersions).toMatchObject({ title: 1, slug: 1, authors: 1, hero: 1 });
    // data には relation フィールドが入らない
    expect(result.record.data["authors"]).toBeUndefined();

    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql
        .exec<{ data: string }>("SELECT data FROM records WHERE id = ?", uuid(10))
        .one();
      expect(JSON.parse(stored.data)["authors"]).toBeUndefined();
      const rels = state.storage.sql
        .exec<{ source_field: string; target_id: string; ordinal: number }>(
          "SELECT source_field, target_id, ordinal FROM relations WHERE source_id = ? ORDER BY source_field, ordinal",
          uuid(10),
        )
        .toArray();
      expect(rels).toEqual([
        { source_field: "authors", target_id: uuid(2), ordinal: 0 },
        { source_field: "authors", target_id: uuid(3), ordinal: 1 },
        { source_field: "hero", target_id: uuid(4), ordinal: 0 },
      ]);
    });
  });

  it("rejects input that fails validate-on-write (missing required title)", async () => {
    const { title: _t, ...rest } = validArticleInput();
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        {
          recordId: uuid(11),
          input: rest,
        },
        auth("user-a"),
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("rejects an empty required text through the whole stack (G7)", async () => {
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(12), input: { ...validArticleInput(), title: "" } },
        auth("user-a"),
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("returns unknown_type for an unregistered type", async () => {
    const result = asWriteResult(
      await stub.writeRecord(
        "nope",
        {
          recordId: uuid(13),
          input: validArticleInput(),
        },
        auth("user-a"),
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "unknown_type" });
  });

  it("bumps only the changed field's counter on update", async () => {
    await stub.writeRecord(
      "article",
      {
        recordId: uuid(14),
        input: validArticleInput(),
      },
      auth("a"),
    );
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(14), input: { ...validArticleInput(), title: "改題" } },
        auth("b"),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.record.version).toBe(2);
    expect(result.record.seq).toBe(2);
    expect(result.record.fieldVersions["title"]).toBe(2);
    expect(result.record.fieldVersions["slug"]).toBe(1);
    expect(result.record.updatedBy).toBe("b");
    expect(result.changedFields).toEqual(["title"]);
  });

  it("treats an identical write as a no-op (no version/seq bump)", async () => {
    await stub.writeRecord(
      "article",
      {
        recordId: uuid(15),
        input: validArticleInput(),
      },
      auth("a"),
    );
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        {
          recordId: uuid(15),
          input: validArticleInput(),
        },
        auth("a"),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(false);
    expect(result.record.version).toBe(1);
  });

  it("applies unknown-key-only edits (lazy conformance carries them)", async () => {
    await stub.writeRecord(
      "article",
      {
        recordId: uuid(16),
        input: validArticleInput(),
      },
      auth("a"),
    );
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(16), input: { ...validArticleInput(), legacy_field: "kept" } },
        auth("a"),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.record.data["legacy_field"]).toBe("kept");
    expect(result.changedFields).toEqual([]);
  });

  it("reprojects relations on reorder and clears omitted optional relations", async () => {
    const input = validArticleInput();
    await stub.writeRecord("article", { recordId: uuid(17), input }, auth("a"));
    const reordered: Record<string, unknown> = {
      ...input,
      authors: [
        { type: "author", id: uuid(3) },
        { type: "author", id: uuid(2) },
      ],
    };
    const { hero: _hero, ...withoutHero } = reordered;
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        {
          recordId: uuid(17),
          input: withoutHero,
        },
        auth("a"),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedFields.toSorted()).toEqual(["authors", "hero"]);
    await runInDurableObject(stub, async (_instance, state) => {
      const rels = state.storage.sql
        .exec<{ source_field: string; target_id: string; ordinal: number }>(
          "SELECT source_field, target_id, ordinal FROM relations WHERE source_id = ? ORDER BY source_field, ordinal",
          uuid(17),
        )
        .toArray();
      expect(rels).toEqual([
        { source_field: "authors", target_id: uuid(3), ordinal: 0 },
        { source_field: "authors", target_id: uuid(2), ordinal: 1 },
      ]);
    });
  });

  it("changes workflow status alone (version bump, no field version change)", async () => {
    await stub.writeRecord(
      "article",
      {
        recordId: uuid(18),
        input: validArticleInput(),
      },
      auth("a"),
    );
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        {
          recordId: uuid(18),
          input: validArticleInput(),
          status: "in_review",
        },
        auth("a"),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.record.status).toBe("in_review");
    expect(result.record.version).toBe(2);
    expect(result.changedFields).toEqual([]);
  });

  it("rejects a non-lowercase-uuid recordId", async () => {
    for (const badId of ["not-a-uuid", "018F2B6A-7A0A-7000-8000-000000000001"]) {
      const result = asWriteResult(
        await stub.writeRecord(
          "article",
          {
            recordId: badId,
            input: validArticleInput(),
          },
          auth("a"),
        ),
      );
      expect(result).toMatchObject({ ok: false, code: "validation_failed" });
    }
  });

  it("clears relations of fields removed from the type definition", async () => {
    await stub.writeRecord(
      "article",
      {
        recordId: uuid(50),
        input: validArticleInput(),
      },
      auth("a"),
    );
    const withoutHero = articleType();
    withoutHero.fields = withoutHero.fields.filter((field) => field.key !== "hero");
    const rereg = await stub.registerContentType(withoutHero, auth("admin"));
    expect(rereg.ok).toBe(true);
    const { hero: _hero, ...input } = validArticleInput();
    const result = asWriteResult(
      await stub.writeRecord("article", { recordId: uuid(50), input }, auth("a")),
    );
    expect(result.ok).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      const fields = state.storage.sql
        .exec<{ source_field: string }>(
          "SELECT DISTINCT source_field FROM relations WHERE source_id = ?",
          uuid(50),
        )
        .toArray()
        .map((row) => row.source_field);
      expect(fields).toEqual(["authors"]);
    });
  });

  it("exposes the stored record via getRecord", async () => {
    await stub.writeRecord(
      "article",
      {
        recordId: uuid(19),
        input: validArticleInput(),
      },
      auth("a"),
    );
    const record = asRecordSnapshot(await stub.getRecord(uuid(19)));
    expect(record?.type).toBe("article");
    expect(record?.data["title"]).toBe("こんにちは");
    expect(asRecordSnapshot(await stub.getRecord(uuid(99)))).toBeNull();
  });

  async function bodyRelationRows(recordId: string) {
    return runInDurableObject(stub, async (_instance, state) =>
      state.storage.sql
        .exec<{ source_field: string; target_type: string; target_id: string; ordinal: number }>(
          "SELECT source_field, target_type, target_id, ordinal FROM relations WHERE source_id = ? AND origin = 'body' ORDER BY ordinal",
          recordId,
        )
        .toArray(),
    );
  }

  it("projects richtext mentions into relations with origin='body'", async () => {
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        {
          recordId: uuid(30),
          input: {
            ...validArticleInput(),
            body: mentionBody([
              { type: "author", id: uuid(2) },
              { type: "note", id: uuid(5) }, // 未登録型への dangling 参照も可(ソフト参照)
            ]),
          },
        },
        auth("user-a"),
      ),
    );
    expect(result.ok).toBe(true);
    expect(await bodyRelationRows(uuid(30))).toEqual([
      { source_field: "body", target_type: "author", target_id: uuid(2), ordinal: 0 },
      { source_field: "body", target_type: "note", target_id: uuid(5), ordinal: 1 },
    ]);
    // field 由来の行は独立して残る(authors 2 件 + hero 1 件)
    await runInDurableObject(stub, async (_instance, state) => {
      const fieldRows = state.storage.sql
        .exec<{ origin: string }>(
          "SELECT origin FROM relations WHERE source_id = ? AND origin = 'field'",
          uuid(30),
        )
        .toArray();
      expect(fieldRows).toHaveLength(3);
    });
  });

  it("reprojects body relations on every applied write (design-spec §6)", async () => {
    await stub.writeRecord(
      "article",
      {
        recordId: uuid(31),
        input: { ...validArticleInput(), body: mentionBody([{ type: "author", id: uuid(2) }]) },
      },
      auth("a"),
    );
    // mention を差し替え → 行が張り直される
    await stub.writeRecord(
      "article",
      {
        recordId: uuid(31),
        input: { ...validArticleInput(), body: mentionBody([{ type: "author", id: uuid(3) }]) },
      },
      auth("a"),
    );
    expect(await bodyRelationRows(uuid(31))).toEqual([
      { source_field: "body", target_type: "author", target_id: uuid(3), ordinal: 0 },
    ]);
    // mention を全部消す → 行が消える(空 doc は richTextEnvelopeSchema を満たす)
    await stub.writeRecord(
      "article",
      {
        recordId: uuid(31),
        input: {
          ...validArticleInput(),
          body: { schemaVersion: 1, doc: { type: "doc", content: [] } },
        },
      },
      auth("a"),
    );
    expect(await bodyRelationRows(uuid(31))).toEqual([]);
  });

  it("keeps richtext value in data and out of the relations diff", async () => {
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        {
          recordId: uuid(32),
          input: { ...validArticleInput(), body: mentionBody([{ type: "author", id: uuid(2) }]) },
        },
        auth("a"),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // richtext は data に残る(mention は data と relations の両方に現れる — relations は派生)
    expect(result.record.data["body"]).toMatchObject({ schemaVersion: 1 });
    expect(result.record.fieldVersions["body"]).toBe(1);
  });
});
