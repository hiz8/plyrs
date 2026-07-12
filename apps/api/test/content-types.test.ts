import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { articleType, uuid } from "./fixtures";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("content type registration", () => {
  it("registers a valid user type with server-managed version 1", async () => {
    const stub = freshStub();
    const result = await stub.registerContentType(articleType());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType.version).toBe(1);
      expect(result.contentType.key).toBe("article");
    }
  });

  it("persists the row and returns parsed fields via getContentType", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType());
    const row = await stub.getContentType("article");
    expect(row?.name).toBe("記事");
    expect(row?.fields.map((f) => f.key)).toContain("slug");
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql
        .exec<{ key: string; version: number }>("SELECT key, version FROM content_types")
        .one();
      expect(stored).toEqual({ key: "article", version: 1 });
    });
  });

  it("bumps the version when re-registering the same type (same id)", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType());
    const next = articleType();
    next.name = "記事（改）";
    const result = await stub.registerContentType(next);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType.version).toBe(2);
      expect(result.contentType.name).toBe("記事（改）");
    }
  });

  it("rejects a re-register under the same key with a different id", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType());
    const impostor = { ...articleType(), id: uuid(99) };
    const result = await stub.registerContentType(impostor);
    expect(result).toMatchObject({ ok: false, code: "id_mismatch" });
  });

  it("rejects an invalid definition (duplicate field keys)", async () => {
    const stub = freshStub();
    const bad = articleType();
    bad.fields = [
      { key: "title", type: "text" },
      { key: "title", type: "number" },
    ];
    const result = await stub.registerContentType(bad);
    expect(result).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("accepts a namespaced plugin type and returns null for unknown keys", async () => {
    const stub = freshStub();
    const pluginType = {
      ...articleType(),
      id: uuid(5),
      key: "booking.slot",
      source: "plugin" as const,
      pluginId: "booking",
    };
    const result = await stub.registerContentType(pluginType);
    expect(result.ok).toBe(true);
    expect(await stub.getContentType("no_such_type")).toBeNull();
  });
});
