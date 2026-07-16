import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  collectIncludeTargetIds,
  expandIncludes,
  loadFieldRelationIdsForRecords,
} from "./include";
import { toPublicRecord } from "./serialize";

const tenantId = crypto.randomUUID();
let relationOrdinal = 0;

async function seedRecord(id: string, type: string, data: Record<string, unknown>): Promise<void> {
  await env.PROJECTION_DB.prepare(
    "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, ?3, NULL, '2026-07-14T00:00:00.000Z', ?4, 1, 1, 0)",
  )
    .bind(tenantId, id, type, JSON.stringify(data))
    .run();
}

async function seedRelation(
  sourceId: string,
  sourceField: string,
  targetId: string,
  origin = "field",
): Promise<void> {
  const ordinal = relationOrdinal++;
  await env.PROJECTION_DB.prepare(
    "INSERT INTO projected_relations (tenant_id, source_id, source_field, target_type, target_id, ordinal, origin) VALUES (?1, ?2, ?3, 'author', ?4, ?5, ?6)",
  )
    .bind(tenantId, sourceId, sourceField, targetId, ordinal, origin)
    .run();
}

beforeAll(async () => {
  // テーブルをクリアして再セット
  await env.PROJECTION_DB.prepare("DELETE FROM projected_relations WHERE tenant_id = ?")
    .bind(tenantId)
    .run();
  await env.PROJECTION_DB.prepare("DELETE FROM projected_records WHERE tenant_id = ?")
    .bind(tenantId)
    .run();

  await seedRecord("post1", "post", { title: "一" });
  await seedRecord("post2", "post", { title: "二" });
  await seedRecord("author1", "author", { name: "著者1" });
  await seedRecord("author2", "author", { name: "著者2" });
  // author3 は projected_records に存在しない = 未公開（ソフト参照で不在になる）
  await seedRelation("post1", "authors", "author1");
  await seedRelation("post1", "authors", "author3");
  await seedRelation("post2", "authors", "author1"); // 重複排除の検証
  await seedRelation("post2", "authors", "author2");
  await seedRelation("post2", "hero", "author2"); // 対象外フィールド
  await seedRelation("post1", "embedded", "author2", "body"); // body 由来は展開しない
});

describe("toPublicRecord (裁定 2026-07-14: 内部値非公開・fields 入れ子)", () => {
  it("maps the row into the public shape without internal values", () => {
    const record = toPublicRecord({
      record_id: "r1",
      type: "post",
      slug: "hello",
      published_at: "2026-07-14T00:00:00.000Z",
      data: JSON.stringify({ title: "t", rating: 5 }),
    });
    expect(record).toStrictEqual({
      id: "r1",
      type: "post",
      slug: "hello",
      publishedAt: "2026-07-14T00:00:00.000Z",
      fields: { title: "t", rating: 5 },
    });
  });
});

describe("loadFieldRelationIdsForRecords (field 由来のみ・ordinal 順)", () => {
  it("maps record ids to per-field ordered target id arrays", async () => {
    const map = await loadFieldRelationIdsForRecords(env.PROJECTION_DB, tenantId, [
      "post1",
      "post2",
    ]);
    expect(map.get("post1")).toStrictEqual({ authors: ["author1", "author3"] });
    expect(map.get("post2")).toStrictEqual({
      authors: ["author1", "author2"],
      hero: ["author2"],
    });
  });

  it("excludes body-origin relations", async () => {
    const map = await loadFieldRelationIdsForRecords(env.PROJECTION_DB, tenantId, ["post1"]);
    expect(map.get("post1")?.["embedded"]).toBeUndefined();
  });

  it("chunks large id lists under the D1 bind limit", async () => {
    const sources = Array.from({ length: 120 }, (_, i) => `ghost-${i}`).concat(["post1"]);
    const map = await loadFieldRelationIdsForRecords(env.PROJECTION_DB, tenantId, sources);
    expect(map.get("post1")).toStrictEqual({ authors: ["author1", "author3"] });
  });
});

describe("collectIncludeTargetIds (Phase 5c: 二重読みの解消)", () => {
  it("collects ids of the requested fields only, deduped across records", async () => {
    const map = await loadFieldRelationIdsForRecords(env.PROJECTION_DB, tenantId, [
      "post1",
      "post2",
    ]);
    expect(collectIncludeTargetIds(map, ["authors"]).toSorted()).toStrictEqual([
      "author1",
      "author2",
      "author3",
    ]);
    expect(collectIncludeTargetIds(map, ["hero"])).toStrictEqual(["author2"]);
    expect(collectIncludeTargetIds(map, [])).toStrictEqual([]);
    expect(collectIncludeTargetIds(new Map(), ["authors"])).toStrictEqual([]);
  });
});

describe("expandIncludes (§12.5: projected_records の取得とソフト参照)", () => {
  it("fetches published targets sorted by id, dropping unpublished ones", async () => {
    const included = await expandIncludes(env.PROJECTION_DB, tenantId, [
      "author2",
      "author1",
      "author3",
    ]);
    expect(included.map((record) => record.id)).toStrictEqual(["author1", "author2"]);
  });

  it("returns empty for empty input", async () => {
    expect(await expandIncludes(env.PROJECTION_DB, tenantId, [])).toStrictEqual([]);
  });

  it("chunks large target lists under the D1 bind limit", async () => {
    const targets = Array.from({ length: 120 }, (_, i) => `ghost-${i}`).concat(["author1"]);
    const included = await expandIncludes(env.PROJECTION_DB, tenantId, targets);
    expect(included.map((record) => record.id)).toStrictEqual(["author1"]);
  });
});
