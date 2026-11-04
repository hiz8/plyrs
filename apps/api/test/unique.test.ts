import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { parseRecordListInput } from "../src/do/list-records";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("unique system hook", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
    await stub.writeRecord(
      "article",
      { recordId: uuid(20), input: validArticleInput() },
      auth("a"),
    );
  });

  it("rejects a second record with the same unique slug", async () => {
    const result = await stub.writeRecord(
      "article",
      { recordId: uuid(21), input: { ...validArticleInput(), title: "別記事" } },
      auth("a"),
    );
    expect(result).toMatchObject({ ok: false, code: "unique_violation" });
    expect(await stub.getRecord(uuid(21))).toBeNull();
  });

  it("allows updating the record that owns the unique value", async () => {
    const result = await stub.writeRecord(
      "article",
      { recordId: uuid(20), input: { ...validArticleInput(), title: "改題" } },
      auth("a"),
    );
    expect(result.ok).toBe(true);
  });

  it("allows the same slug in a different content type", async () => {
    const noteType = {
      ...articleType(),
      id: uuid(30),
      key: "note",
      fields: [
        { key: "title", type: "text" as const, required: true },
        { key: "slug", type: "text" as const, config: { unique: true } },
      ],
    };
    await stub.registerContentType(noteType, auth("admin"));
    const result = await stub.writeRecord(
      "note",
      { recordId: uuid(31), input: { title: "ノート", slug: "hello" } },
      auth("a"),
    );
    expect(result.ok).toBe(true);
  });

  it("ignores records without the optional unique field", async () => {
    const noteType = {
      ...articleType(),
      id: uuid(32),
      key: "memo",
      fields: [
        { key: "title", type: "text" as const, required: true },
        { key: "slug", type: "text" as const, config: { unique: true } },
      ],
    };
    await stub.registerContentType(noteType, auth("admin"));
    const first = await stub.writeRecord(
      "memo",
      { recordId: uuid(33), input: { title: "一" } },
      auth("a"),
    );
    const second = await stub.writeRecord(
      "memo",
      { recordId: uuid(34), input: { title: "二" } },
      auth("a"),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });
});

describe("unique だけのフィールド(決定 54)", () => {
  function counterType() {
    return {
      ...articleType(),
      id: uuid(40),
      key: "counter",
      fields: [
        { key: "title", type: "text" as const, required: true },
        { key: "code", type: "text" as const, config: { unique: true } },
        { key: "num", type: "number" as const, config: { unique: true } },
      ],
    };
  }

  it("indexed でなくても重複を見つける", async () => {
    const stub = freshStub();
    await stub.registerContentType(counterType(), auth("admin"));
    expect(
      (
        await stub.writeRecord(
          "counter",
          { recordId: uuid(41), input: { title: "a", code: "c" } },
          auth("a"),
        )
      ).ok,
    ).toBe(true);
    expect(
      await stub.writeRecord(
        "counter",
        { recordId: uuid(42), input: { title: "b", code: "c" } },
        auth("a"),
      ),
    ).toMatchObject({ ok: false, code: "unique_violation" });
  });

  it('比較は生成カラムの affinity に従う: 型を変える前の文字列 "10" があると数値 10 は unique_violation', async () => {
    const stub = freshStub();
    await stub.registerContentType(counterType(), auth("admin"));
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO records (id, type, data, status, version, seq, created_at, updated_at, created_by, updated_by) VALUES (?, 'counter', ?, 'draft', 1, 999, ?, ?, 'x', 'x')",
        uuid(43),
        JSON.stringify({ title: "旧", num: "10" }),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    });
    expect(
      await stub.writeRecord(
        "counter",
        { recordId: uuid(44), input: { title: "新", num: 10 } },
        auth("a"),
      ),
    ).toMatchObject({ ok: false, code: "unique_violation" });
  });
});
