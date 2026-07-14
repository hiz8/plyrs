import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { canonicalCacheUrl, withEdgeCache, type EdgeCacheContext } from "../public/cache";
import { loadCatalog, type CatalogEntry } from "../public/catalog";
import { encodeCursor } from "../public/cursor";
import { expandIncludes } from "../public/include";
import { parseInclude, parseListQuery } from "../public/query";
import { toPublicRecord, type ProjectedRecordRow } from "../public/serialize";
import { buildListQuery, placeholders, type ListRow } from "../public/sql";
import { resolveTenantId } from "../public/tenant-resolver";

// design-spec §12.4〜12.7 / G3: 公開 read API。投影 D1（+ コントロールプレーン D1 と KV の
// テナント解決）だけを読み、DO は絶対に起こさない。認証なし（公開経路）。
// projection_tombstones は読まない: projected_records に行が無ければ見えない、が公開状態の全て。

// 型キーはプラグイン名前空間（blog.post）も通す。形が違うものは D1 を引かず 404
const TYPE_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/u;
const MAX_PARAM_LENGTH = 256;

interface SingleRow extends ProjectedRecordRow {
  publish_seq: number;
}

type PublicEnv = { Bindings: Env };

const SINGLE_COLUMNS = "record_id, type, slug, published_at, data, publish_seq";

const RELATION_ID_CHUNK_SIZE = 50; // D1 のバインド上限（100/クエリ）への安全マージン

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// design-spec §6: 関係は data に入らない（write-record.test.ts で確定済みの不変条件）ので
// toPublicRecord() が返す fields には関係フィールドの値が一切現れない。裁定（2026-07-14 #3）:
// 既定でも関係フィールドは ID 配列として fields に現れる — include は included[] の同梱だけを
// 制御し、fields の形を変えない。未公開参照先の ID も残る（ソフト参照で included にだけ現れない）。
// 単体・一覧の両方から呼ぶ: 対象 record_id 全件の field 由来の関係をチャンク内 1 回で引き、
// record_id → フィールド別 ID 配列 の Map を返す（カタログ不要: 非関係フィールドはそもそも行が無い）。
async function loadFieldRelationIdsForRecords(
  db: D1Database,
  tenantId: string,
  recordIds: string[],
): Promise<Map<string, Record<string, string[]>>> {
  const byRecord = new Map<string, Record<string, string[]>>();
  for (const idChunk of chunk(recordIds, RELATION_ID_CHUNK_SIZE)) {
    const { results } = await db
      .prepare(
        "SELECT source_id, source_field, target_id FROM projected_relations" +
          " WHERE tenant_id = ? AND origin = 'field'" +
          ` AND source_id IN (${placeholders(idChunk.length)})` +
          " ORDER BY source_field, ordinal",
      )
      .bind(tenantId, ...idChunk)
      .all<{ source_id: string; source_field: string; target_id: string }>();
    for (const row of results) {
      const byField = byRecord.get(row.source_id) ?? {};
      const list = byField[row.source_field] ?? [];
      list.push(row.target_id);
      byField[row.source_field] = list;
      byRecord.set(row.source_id, byField);
    }
  }
  return byRecord;
}

// Hono の Context#executionCtx は自前の簡略 ExecutionContext 型（waitUntil / passThroughOnException
// のみ）を返し、workers-types のリッチな ExecutionContext（tracing 等を要求）とは構造的に不一致
// なので EdgeCacheContext へそのまま渡せない。実体は同じ CF ランタイムの ExecutionContext なので、
// withEdgeCache が使う waitUntil には何ら影響しない安全な型合わせ。get にするのは必須:
// c.executionCtx は ExecutionContext の無い環境（app.request 直呼び）で参照時に例外を投げる
// 遅延ゲッタであり、withEdgeCache 側の try/catch がそれを前提にしている（即時評価すると素通しできない）。
function edgeCacheContextFor(c: Context<PublicEnv>): EdgeCacheContext {
  return {
    req: c.req,
    get executionCtx(): ExecutionContext {
      return c.executionCtx as ExecutionContext;
    },
  };
}

async function serveSingle(
  c: Context<PublicEnv>,
  lookup: "id" | "slug",
  value: string,
): Promise<Response> {
  const type = c.req.param("type") ?? "";
  const tenantSlug = c.req.param("tenantSlug") ?? "";
  // "." / ".." はキャッシュキー URL のドットセグメント正規化の残余を閉じる（そもそも実 record_id /
  // slug ではないが、正規化経由でキャッシュキーが化けないよう入口で明示的に弾く）
  if (
    !TYPE_KEY_PATTERN.test(type) ||
    value.length === 0 ||
    value.length > MAX_PARAM_LENGTH ||
    value === "." ||
    value === ".."
  ) {
    return c.json({ error: "not_found" }, 404);
  }
  const tenantId = await resolveTenantId(c.env, tenantSlug);
  if (tenantId === null) {
    return c.json({ error: "unknown_tenant" }, 404);
  }
  const params = c.req.queries();
  for (const key of Object.keys(params)) {
    if (key !== "include") {
      return c.json({ error: "bad_query", message: `unknown query param: ${key}` }, 400);
    }
  }
  let include: string[] = [];
  const includeParam = params["include"];
  if (includeParam !== undefined) {
    if (includeParam.length !== 1 || includeParam[0] === undefined) {
      return c.json({ error: "bad_query", message: "query param must appear once: include" }, 400);
    }
    const catalog = await loadCatalog(c.env.PROJECTION_DB, tenantId, type);
    const parsed = parseInclude(includeParam[0], catalog);
    if (!parsed.ok) {
      return c.json({ error: "bad_query", message: parsed.error }, 400);
    }
    include = parsed.include;
  }
  // slug は任意文字を含みうるため、キャッシュキー URL のフラグメント/クエリ境界に化けないようエンコードする
  const cacheUrl = canonicalCacheUrl(
    tenantId,
    `records/${type}/${lookup}/${encodeURIComponent(value)}`,
    params,
  );
  return withEdgeCache(edgeCacheContextFor(c), cacheUrl, async () => {
    const row =
      lookup === "id"
        ? await c.env.PROJECTION_DB.prepare(
            `SELECT ${SINGLE_COLUMNS} FROM projected_records WHERE tenant_id = ?1 AND record_id = ?2 AND type = ?3`,
          )
            .bind(tenantId, value, type)
            .first<SingleRow>()
        : await c.env.PROJECTION_DB.prepare(
            `SELECT ${SINGLE_COLUMNS} FROM projected_records WHERE tenant_id = ?1 AND type = ?2 AND slug = ?3`,
          )
            .bind(tenantId, type, value)
            .first<SingleRow>();
    if (row === null) {
      return c.json({ error: "not_found" }, 404);
    }
    const record = toPublicRecord(row);
    // 既定でも関係フィールドは ID 配列として fields に現れる（裁定: include は included[] の
    // 同梱だけを制御し、fields の形を変えない。未公開参照先の ID も残る — ソフト参照で
    // included にだけ現れない）。
    const relationIds = await loadFieldRelationIdsForRecords(c.env.PROJECTION_DB, tenantId, [
      row.record_id,
    ]);
    const base = {
      ...record,
      fields: {
        ...record.fields,
        ...(relationIds.get(row.record_id) ?? {}),
      },
    };
    const body =
      include.length > 0
        ? {
            ...base,
            included: await expandIncludes(c.env.PROJECTION_DB, tenantId, [row.record_id], include),
          }
        : base;
    const response = c.json(body);
    // 裁定: publish_seq は公開しないが ETag の弱い検証子としての内部利用は可
    response.headers.set("etag", `W/"${row.publish_seq}"`);
    return response;
  });
}

export const publicRoutes = new Hono<PublicEnv>()
  .use("*", cors({ origin: "*", allowMethods: ["GET", "HEAD", "OPTIONS"] }))
  // 注意: 一覧ルートを slug / :id ルートより先に登録する（/records/:type が /records/:type/... の
  // どちらとも被らないことを明示的に保証）
  .get("/:tenantSlug/records/:type", async (c) => {
    const type = c.req.param("type") ?? "";
    if (!TYPE_KEY_PATTERN.test(type)) {
      return c.json({ error: "not_found" }, 404);
    }
    const tenantId = await resolveTenantId(c.env, c.req.param("tenantSlug") ?? "");
    if (tenantId === null) {
      return c.json({ error: "unknown_tenant" }, 404);
    }
    const params = c.req.queries();
    // 最頻の「素の一覧」（フィルタ/ソート/include なし）でカタログの 1 クエリを節約する。
    // 空カタログでも既定ソート（システム published_at）と limit/cursor 検証は成立する。
    const needsCatalog = Object.keys(params).some(
      (key) => key === "sort" || key === "include" || key.startsWith("filter["),
    );
    const catalog = needsCatalog
      ? await loadCatalog(c.env.PROJECTION_DB, tenantId, type)
      : new Map<string, CatalogEntry>();
    const parsed = parseListQuery(params, catalog);
    if (!parsed.ok) {
      return c.json({ error: "bad_query", message: parsed.error }, 400);
    }
    const query = parsed.query;
    const cacheUrl = canonicalCacheUrl(tenantId, `records/${type}`, params);
    return withEdgeCache(edgeCacheContextFor(c), cacheUrl, async () => {
      const built = buildListQuery(tenantId, type, query);
      const { results } = await c.env.PROJECTION_DB.prepare(built.sql)
        .bind(...built.binds)
        .all<ListRow>();
      const hasMore = results.length > query.limit;
      const page = hasMore ? results.slice(0, query.limit) : results;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last !== undefined
          ? encodeCursor({
              k:
                query.sort.column === "published_at"
                  ? last.published_at
                  : (last.sort_value ?? null),
              id: last.record_id,
            })
          : null;
      // 裁定（2026-07-14 controller amendment）: 一覧 items にも単体と同じく関係フィールドを
      // ID 配列として常時マージする（§6 の通り関係は data に入らないため、そのままでは items の
      // fields から欠落し単体レスポンスと形が食い違う）。include の有無で fields の形は変えない
      // （include は included[] の同梱だけを制御）。ページの record_id 全件をチャンク内 1 回で引く。
      const relationIds = await loadFieldRelationIdsForRecords(
        c.env.PROJECTION_DB,
        tenantId,
        page.map((row) => row.record_id),
      );
      const items = page.map((row) => {
        const record = toPublicRecord(row);
        return {
          ...record,
          fields: {
            ...record.fields,
            ...(relationIds.get(row.record_id) ?? {}),
          },
        };
      });
      const body: Record<string, unknown> = { items, nextCursor };
      if (query.include.length > 0) {
        body["included"] = await expandIncludes(
          c.env.PROJECTION_DB,
          tenantId,
          page.map((row) => row.record_id),
          query.include,
        );
      }
      return c.json(body);
    });
  })
  // 注意: slug ルートを :id ルートより先に登録する（静的セグメント優先を明示的に保証）
  .get("/:tenantSlug/records/:type/slug/:slug", (c) =>
    serveSingle(c, "slug", c.req.param("slug") ?? ""),
  )
  .get("/:tenantSlug/records/:type/:id", (c) => serveSingle(c, "id", c.req.param("id") ?? ""));
