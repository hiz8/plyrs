import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asRecordSnapshot, asWriteResult } from "./rpc-unwrap";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("stage-2 authorization at the DO RPC entry", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    const registered = await stub.registerContentType(articleType(), auth("admin"));
    expect(registered.ok).toBe(true);
  });

  it("denies record writes to viewers and persists nothing", async () => {
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(60), input: validArticleInput() },
        auth("mallory", "viewer"),
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    expect(asRecordSnapshot(await stub.getRecord(uuid(60)))).toBeNull();
  });

  it("denies type management to editors but allows record writes", async () => {
    const denied = await stub.registerContentType(articleType(), auth("eve", "editor"));
    expect(denied).toMatchObject({ ok: false, code: "forbidden" });

    const written = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(61), input: validArticleInput() },
        auth("eve", "editor"),
      ),
    );
    expect(written.ok).toBe(true);
    if (written.ok) {
      expect(written.record.createdBy).toBe("eve");
    }
  });

  it("denies deletion to viewers and allows it to editors", async () => {
    await stub.writeRecord(
      "article",
      { recordId: uuid(62), input: validArticleInput() },
      auth("eve", "editor"),
    );
    expect(await stub.deleteRecord(uuid(62), auth("mallory", "viewer"))).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    const deleted = await stub.deleteRecord(uuid(62), auth("eve", "editor"));
    expect(deleted.ok).toBe(true);
  });

  it("lets owners do everything", async () => {
    const written = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(63), input: validArticleInput() },
        auth("root", "owner"),
      ),
    );
    expect(written.ok).toBe(true);
    expect(await stub.deleteRecord(uuid(63), auth("root", "owner"))).toMatchObject({ ok: true });
  });
});
