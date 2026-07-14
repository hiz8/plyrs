import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { expandIncludes } from "./include";
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
  await env.PROJECTION_DB.prepare("DELETE FROM projected_relations WHERE tenant_id = ?").bind(tenantId).run();
  await env.PROJECTION_DB.prepare("DELETE FROM projected_records WHERE tenant_id = ?").bind(tenantId).run();

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

describe("expandIncludes (§12.5: projected_relations のみ・ソフト参照)", () => {
  it("collects published targets of the requested fields, deduped, sorted by id", async () => {
    const included = await expandIncludes(env.PROJECTION_DB, tenantId, ["post1", "post2"], [
      "authors",
    ]);
    expect(included.map((record) => record.id)).toStrictEqual(["author1", "author2"]);
  });

  it("silently drops unpublished targets (soft reference, no error)", async () => {
    const included = await expandIncludes(env.PROJECTION_DB, tenantId, ["post1"], ["authors"]);
    expect(included.map((record) => record.id)).toStrictEqual(["author1"]); // author3 は不在
  });

  it("only expands field-origin relations of the requested fields", async () => {
    const included = await expandIncludes(env.PROJECTION_DB, tenantId, ["post1"], ["embedded"]);
    expect(included).toStrictEqual([]); // body 由来は対象外
  });

  it("returns empty for empty inputs", async () => {
    expect(await expandIncludes(env.PROJECTION_DB, tenantId, [], ["authors"])).toStrictEqual([]);
    expect(await expandIncludes(env.PROJECTION_DB, tenantId, ["post1"], [])).toStrictEqual([]);
  });

  it("chunks large id lists under the D1 bind limit", async () => {
    // 120 ソース（実在するのは post1/post2 のみ）でもエラーにならず正しく返る
    const sources = Array.from({ length: 120 }, (_, i) => `ghost-${i}`).concat(["post1"]);
    const included = await expandIncludes(env.PROJECTION_DB, tenantId, sources, ["authors"]);
    expect(included.map((record) => record.id)).toStrictEqual(["author1"]);
  });
});
