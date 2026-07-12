import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, uuid, validArticleInput } from "./fixtures";
import { asDeleteResult, asRecordSnapshot, asWriteResult } from "./rpc-unwrap";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("deleteRecord (tombstone)", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType());
    await stub.writeRecord("article", {
      recordId: uuid(40),
      input: validArticleInput(),
      actor: "a",
    });
  });

  it("sets the tombstone and removes outgoing relations", async () => {
    const result = asDeleteResult(await stub.deleteRecord(uuid(40), "b"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.deletedAt).not.toBeNull();
    expect(result.record.version).toBe(2);
    expect(result.record.seq).toBe(2);
    expect(result.record.updatedBy).toBe("b");
    await runInDurableObject(stub, async (_instance, state) => {
      const relCount = state.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM relations WHERE source_id = ?", uuid(40))
        .one().n;
      expect(relCount).toBe(0);
      const row = state.storage.sql
        .exec<{ deleted_at: string | null }>(
          "SELECT deleted_at FROM records WHERE id = ?",
          uuid(40),
        )
        .one();
      expect(row.deleted_at).not.toBeNull();
    });
  });

  it("keeps the tombstone visible via getRecord", async () => {
    asDeleteResult(await stub.deleteRecord(uuid(40), "b"));
    const record = asRecordSnapshot(await stub.getRecord(uuid(40)));
    expect(record?.deletedAt).not.toBeNull();
  });

  it("rejects writes to a deleted record", async () => {
    asDeleteResult(await stub.deleteRecord(uuid(40), "b"));
    const result = asWriteResult(
      await stub.writeRecord("article", {
        recordId: uuid(40),
        input: validArticleInput(),
        actor: "a",
      }),
    );
    expect(result).toMatchObject({ ok: false, code: "record_deleted" });
  });

  it("rejects double deletion and unknown ids distinctly", async () => {
    asDeleteResult(await stub.deleteRecord(uuid(40), "b"));
    expect(asDeleteResult(await stub.deleteRecord(uuid(40), "b"))).toMatchObject({
      ok: false,
      code: "already_deleted",
    });
    expect(asDeleteResult(await stub.deleteRecord(uuid(41), "b"))).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("frees unique values for new records (unique ignores tombstones)", async () => {
    asDeleteResult(await stub.deleteRecord(uuid(40), "b"));
    const result = asWriteResult(
      await stub.writeRecord("article", {
        recordId: uuid(42),
        input: validArticleInput(),
        actor: "a",
      }),
    );
    expect(result.ok).toBe(true);
  });
});
