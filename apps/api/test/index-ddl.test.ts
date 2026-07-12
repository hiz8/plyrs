import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@plyrs/metamodel";
import { computeIndexDdlDiff, generatedColumnName, indexedColumns } from "../src/do/index-ddl";
import { articleType } from "./fixtures";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("indexedColumns / computeIndexDdlDiff (pure)", () => {
  it("promotes only single-valued indexed fields with type-mapped columns", () => {
    const fields: FieldDefinition[] = [
      { key: "slug", type: "text", config: { indexed: true } },
      { key: "views", type: "number", config: { indexed: true } },
      { key: "featured", type: "boolean", config: { indexed: true } },
      { key: "published_at", type: "datetime", config: { indexed: true } },
      {
        key: "category",
        type: "select",
        config: { options: [{ value: "a", label: "A" }], indexed: true },
      },
      {
        key: "tags",
        type: "select",
        config: { options: [{ value: "a", label: "A" }], multiple: true, indexed: true },
      },
      { key: "plain", type: "text" },
      { key: "body", type: "richtext" },
    ];
    expect(indexedColumns(fields)).toEqual([
      { fieldKey: "slug", columnType: "TEXT" },
      { fieldKey: "views", columnType: "NUMERIC" },
      { fieldKey: "featured", columnType: "INTEGER" },
      { fieldKey: "published_at", columnType: "TEXT" },
      { fieldKey: "category", columnType: "TEXT" },
    ]);
  });

  it("computes add / drop / type-change diffs", () => {
    const prev: FieldDefinition[] = [
      { key: "a", type: "text", config: { indexed: true } },
      { key: "b", type: "text", config: { indexed: true } },
    ];
    const next: FieldDefinition[] = [
      { key: "a", type: "number", config: { indexed: true } },
      { key: "c", type: "datetime", config: { indexed: true } },
    ];
    const diff = computeIndexDdlDiff(prev, next);
    expect(diff.add).toEqual([
      { fieldKey: "a", columnType: "NUMERIC" },
      { fieldKey: "c", columnType: "TEXT" },
    ]);
    expect(diff.drop).toEqual([
      { fieldKey: "a", columnType: "TEXT" },
      { fieldKey: "b", columnType: "TEXT" },
    ]);
  });

  it("namespaces generated column names by sanitized type key", () => {
    expect(generatedColumnName("article", "slug")).toBe("g_article_slug");
    expect(generatedColumnName("booking.slot", "starts_at")).toBe("g_booking__slot_starts_at");
  });
});

describe("applyIndexDdl (integration via registerContentType)", () => {
  it("adds generated columns and partial indexes for indexed fields", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType());
    await runInDurableObject(stub, async (_instance, state) => {
      const tableDdl = state.storage.sql
        .exec<{ sql: string }>(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='records'",
        )
        .one().sql;
      expect(tableDdl).toContain("g_article_slug");
      expect(tableDdl).toContain("g_article_published_at");
      const indexes = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'")
        .toArray()
        .map((row) => row.name);
      expect(indexes).toEqual(
        expect.arrayContaining(["idx_g_article_slug", "idx_g_article_published_at"]),
      );
    });
  });

  it("drops the column and index when the indexed declaration is removed", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType());
    const next = articleType();
    next.fields = next.fields.map((field) =>
      field.key === "published_at" ? { ...field, config: {} } : field,
    );
    const result = await stub.registerContentType(next);
    expect(result.ok).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      const tableDdl = state.storage.sql
        .exec<{ sql: string }>(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='records'",
        )
        .one().sql;
      expect(tableDdl).toContain("g_article_slug");
      expect(tableDdl).not.toContain("g_article_published_at");
      const indexes = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'")
        .toArray()
        .map((row) => row.name);
      expect(indexes).not.toContain("idx_g_article_published_at");
    });
  });
});
