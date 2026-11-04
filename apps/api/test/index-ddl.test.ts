import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@plyrs/metamodel";
import { registerAlarm } from "../src/do/alarms";
import {
  checkLookupColumns,
  computeIndexDdlDiff,
  existingGeneratedColumns,
  generatedColumnName,
  indexedColumns,
  LOOKUP_COLUMNS_ALARM,
  LOOKUP_COLUMNS_FLAG,
  lookupColumns,
  missingLookupColumns,
} from "../src/do/index-ddl";
import { articleType, auth, uuid } from "./fixtures";

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
    await stub.registerContentType(articleType(), auth("admin"));
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
    await stub.registerContentType(articleType(), auth("admin"));
    const next = articleType();
    next.fields = next.fields.map((field) =>
      field.key === "published_at" && field.type === "datetime" ? { ...field, config: {} } : field,
    );
    const result = await stub.registerContentType(next, auth("admin"));
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

// 決定 54(M5a-2): unique のフィールドの引き当て用カラム
describe("lookupColumns(決定 54)", () => {
  const uniqueOnly: FieldDefinition[] = [
    { key: "code", type: "text", config: { unique: true } },
    { key: "seq", type: "number", config: { unique: true } },
    { key: "plain", type: "text" },
  ];

  it("unique だけの text / number を含み、indexedColumns は含まない", () => {
    expect(lookupColumns(uniqueOnly)).toEqual([
      { fieldKey: "code", columnType: "TEXT" },
      { fieldKey: "seq", columnType: "NUMERIC" },
    ]);
    expect(indexedColumns(uniqueOnly)).toEqual([]);
  });

  it("unique だけ ⇄ unique + indexed ⇄ indexed だけは差が出ず、両方外すと drop", () => {
    const only: FieldDefinition[] = [{ key: "code", type: "text", config: { unique: true } }];
    const both: FieldDefinition[] = [
      { key: "code", type: "text", config: { unique: true, indexed: true } },
    ];
    const indexedOnly: FieldDefinition[] = [
      { key: "code", type: "text", config: { indexed: true } },
    ];
    const none: FieldDefinition[] = [{ key: "code", type: "text" }];
    expect(computeIndexDdlDiff(only, both)).toEqual({ add: [], drop: [] });
    expect(computeIndexDdlDiff(both, indexedOnly)).toEqual({ add: [], drop: [] });
    expect(computeIndexDdlDiff(both, none)).toEqual({
      add: [],
      drop: [{ fieldKey: "code", columnType: "TEXT" }],
    });
  });
});

describe("既存テナントの unique のフィールド(決定 54、Review Focus 3)", () => {
  function couponType(fields: FieldDefinition[]) {
    return { ...articleType(), id: uuid(90), key: "coupon", fields };
  }
  const M4_FIELDS: FieldDefinition[] = [
    { key: "title", type: "text", required: true },
    { key: "code", type: "text", config: { unique: true } },
    { key: "seq", type: "number", config: { unique: true } },
  ];

  type Instance = { lookupReady: boolean };

  // M4 までの DO の形を作る: unique だけのフィールドに生成カラムが無く、flag も無い
  async function m4Tenant() {
    const stub = freshStub();
    expect((await stub.registerContentType(couponType(M4_FIELDS), auth("admin"))).ok).toBe(true);
    await runInDurableObject(stub, async (instance, state) => {
      const sql = state.storage.sql;
      for (const key of ["code", "seq"]) {
        const name = generatedColumnName("coupon", key);
        sql.exec(`DROP INDEX IF EXISTS idx_${name}`);
        sql.exec(`ALTER TABLE records DROP COLUMN ${name}`);
      }
      sql.exec("DELETE FROM do_config WHERE key = ?", LOOKUP_COLUMNS_FLAG);
      (instance as unknown as Instance).lookupReady = false;
      registerAlarm(sql, LOOKUP_COLUMNS_ALARM, Date.now() - 1_000);
      // 過去の物理アラームは workerd が自動で発火させるので未来にする(module-alarms.test.ts と同じ)
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    return stub;
  }

  it("(a) 起動時の確認は DDL を流さず、足りないカラムを数えるだけ", async () => {
    const stub = await m4Tenant();
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql;
      expect(checkLookupColumns(sql)).toEqual({ ready: false });
      expect(missingLookupColumns(sql).map((m) => m.column.fieldKey)).toEqual(["code", "seq"]);
      expect(existingGeneratedColumns(sql).has(generatedColumnName("coupon", "code"))).toBe(false);
    });
  });

  it("(b) alarm の前は json_extract の走査で重複を見つける", async () => {
    const stub = await m4Tenant();
    const first = await stub.writeRecord(
      "coupon",
      { recordId: uuid(91), input: { title: "a", code: "X1", seq: 1 } },
      auth("a"),
    );
    expect(first.ok).toBe(true);
    const dup = await stub.writeRecord(
      "coupon",
      { recordId: uuid(92), input: { title: "b", code: "X1", seq: 2 } },
      auth("a"),
    );
    expect(dup).toMatchObject({ ok: false, code: "unique_violation" });
  });

  it("(c) alarm の前に unique を外しても、indexed を足しても型の保存が失敗しない", async () => {
    const stub = await m4Tenant();
    const withIndexed: FieldDefinition[] = [
      { key: "title", type: "text", required: true },
      { key: "code", type: "text", config: { unique: true, indexed: true } },
      { key: "seq", type: "number" },
    ];
    expect((await stub.registerContentType(couponType(withIndexed), auth("admin"))).ok).toBe(true);
    await runInDurableObject(stub, (_instance, state) => {
      const existing = existingGeneratedColumns(state.storage.sql);
      // indexed になった code は一覧の絞り込みが引くので、その場で足す
      expect(existing.has(generatedColumnName("coupon", "code"))).toBe(true);
      expect(existing.has(generatedColumnName("coupon", "seq"))).toBe(false);
    });
    // indexed も unique も外す(drop の対象のカラムが無い seq と、ある code)
    expect(
      (await stub.registerContentType(couponType(M4_FIELDS.slice(0, 1)), auth("admin"))).ok,
    ).toBe(true);
    expect((await stub.registerContentType(couponType(M4_FIELDS), auth("admin"))).ok).toBe(true);
  });

  it("(d) alarm を 2 歩回すと flag が立ち、その後は生成カラムで引く", async () => {
    const stub = await m4Tenant();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (instance, state) => {
      expect(missingLookupColumns(state.storage.sql)).toHaveLength(1);
      expect((instance as unknown as Instance).lookupReady).toBe(false);
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (instance, state) => {
      const sql = state.storage.sql;
      expect(missingLookupColumns(sql)).toEqual([]);
      expect(checkLookupColumns(sql)).toEqual({ ready: true });
      expect(
        sql
          .exec<{ n: number }>(
            "SELECT COUNT(*) AS n FROM alarm_registry WHERE kind = ?",
            LOOKUP_COLUMNS_ALARM,
          )
          .one().n,
      ).toBe(0);
      expect((instance as unknown as Instance).lookupReady).toBe(true);
    });
    expect(
      (
        await stub.writeRecord(
          "coupon",
          { recordId: uuid(93), input: { title: "a", code: "Y", seq: 5 } },
          auth("a"),
        )
      ).ok,
    ).toBe(true);
    expect(
      await stub.writeRecord(
        "coupon",
        { recordId: uuid(94), input: { title: "b", code: "Z", seq: 5 } },
        auth("a"),
      ),
    ).toMatchObject({ ok: false, code: "unique_violation" });
  });

  it("新しい DO は型が無いので起動時にそのまま flag が立つ", async () => {
    const stub = freshStub();
    await stub.ping();
    await runInDurableObject(stub, (instance, state) => {
      expect((instance as unknown as Instance).lookupReady).toBe(true);
      expect(
        state.storage.sql
          .exec<{ value: string }>("SELECT value FROM do_config WHERE key = ?", LOOKUP_COLUMNS_FLAG)
          .one().value,
      ).toBe("1");
    });
  });
});
