import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, uuid, validArticleInput } from "./fixtures";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("unique system hook", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType());
    await stub.writeRecord("article", {
      recordId: uuid(20),
      input: validArticleInput(),
      actor: "a",
    });
  });

  it("rejects a second record with the same unique slug", async () => {
    const result = await stub.writeRecord("article", {
      recordId: uuid(21),
      input: { ...validArticleInput(), title: "別記事" },
      actor: "a",
    });
    expect(result).toMatchObject({ ok: false, code: "unique_violation" });
    expect(await stub.getRecord(uuid(21))).toBeNull();
  });

  it("allows updating the record that owns the unique value", async () => {
    const result = await stub.writeRecord("article", {
      recordId: uuid(20),
      input: { ...validArticleInput(), title: "改題" },
      actor: "a",
    });
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
    await stub.registerContentType(noteType);
    const result = await stub.writeRecord("note", {
      recordId: uuid(31),
      input: { title: "ノート", slug: "hello" },
      actor: "a",
    });
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
    await stub.registerContentType(noteType);
    const first = await stub.writeRecord("memo", {
      recordId: uuid(33),
      input: { title: "一" },
      actor: "a",
    });
    const second = await stub.writeRecord("memo", {
      recordId: uuid(34),
      input: { title: "二" },
      actor: "a",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });
});
