import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, uuid, validArticleInput } from "./fixtures";
import { asRecordSnapshot, asWriteResult } from "./rpc-unwrap";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("writeRecord", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    const registered = await stub.registerContentType(articleType());
    expect(registered.ok).toBe(true);
  });

  it("creates a record with bookkeeping columns and reprojected relations", async () => {
    const result = asWriteResult(
      await stub.writeRecord("article", {
        recordId: uuid(10),
        input: validArticleInput(),
        actor: "user-a",
      }),
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
      await stub.writeRecord("article", {
        recordId: uuid(11),
        input: rest,
        actor: "user-a",
      }),
    );
    expect(result).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("rejects an empty required text through the whole stack (G7)", async () => {
    const result = asWriteResult(
      await stub.writeRecord("article", {
        recordId: uuid(12),
        input: { ...validArticleInput(), title: "" },
        actor: "user-a",
      }),
    );
    expect(result).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("returns unknown_type for an unregistered type", async () => {
    const result = asWriteResult(
      await stub.writeRecord("nope", {
        recordId: uuid(13),
        input: validArticleInput(),
        actor: "user-a",
      }),
    );
    expect(result).toMatchObject({ ok: false, code: "unknown_type" });
  });

  it("bumps only the changed field's counter on update", async () => {
    await stub.writeRecord("article", {
      recordId: uuid(14),
      input: validArticleInput(),
      actor: "a",
    });
    const result = asWriteResult(
      await stub.writeRecord("article", {
        recordId: uuid(14),
        input: { ...validArticleInput(), title: "改題" },
        actor: "b",
      }),
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
    await stub.writeRecord("article", {
      recordId: uuid(15),
      input: validArticleInput(),
      actor: "a",
    });
    const result = asWriteResult(
      await stub.writeRecord("article", {
        recordId: uuid(15),
        input: validArticleInput(),
        actor: "a",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(false);
    expect(result.record.version).toBe(1);
  });

  it("applies unknown-key-only edits (lazy conformance carries them)", async () => {
    await stub.writeRecord("article", {
      recordId: uuid(16),
      input: validArticleInput(),
      actor: "a",
    });
    const result = asWriteResult(
      await stub.writeRecord("article", {
        recordId: uuid(16),
        input: { ...validArticleInput(), legacy_field: "kept" },
        actor: "a",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.record.data["legacy_field"]).toBe("kept");
    expect(result.changedFields).toEqual([]);
  });

  it("reprojects relations on reorder and clears omitted optional relations", async () => {
    const input = validArticleInput();
    await stub.writeRecord("article", { recordId: uuid(17), input, actor: "a" });
    const reordered: Record<string, unknown> = {
      ...input,
      authors: [
        { type: "author", id: uuid(3) },
        { type: "author", id: uuid(2) },
      ],
    };
    const { hero: _hero, ...withoutHero } = reordered;
    const result = asWriteResult(
      await stub.writeRecord("article", {
        recordId: uuid(17),
        input: withoutHero,
        actor: "a",
      }),
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
    await stub.writeRecord("article", {
      recordId: uuid(18),
      input: validArticleInput(),
      actor: "a",
    });
    const result = asWriteResult(
      await stub.writeRecord("article", {
        recordId: uuid(18),
        input: validArticleInput(),
        status: "in_review",
        actor: "a",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.record.status).toBe("in_review");
    expect(result.record.version).toBe(2);
    expect(result.changedFields).toEqual([]);
  });

  it("exposes the stored record via getRecord", async () => {
    await stub.writeRecord("article", {
      recordId: uuid(19),
      input: validArticleInput(),
      actor: "a",
    });
    const record = asRecordSnapshot(await stub.getRecord(uuid(19)));
    expect(record?.type).toBe("article");
    expect(record?.data["title"]).toBe("こんにちは");
    expect(asRecordSnapshot(await stub.getRecord(uuid(99)))).toBeNull();
  });
});
