import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { canonicalCacheUrl, withEdgeCache, type EdgeCacheContext } from "../public/cache";
import { loadCatalog, type CatalogEntry } from "../public/catalog";
import { encodeCursor } from "../public/cursor";
import {
  collectIncludeTargetIds,
  expandIncludes,
  loadFieldRelationIdsForRecords,
} from "../public/include";
import { parseInclude, parseListQuery } from "../public/query";
import { toPublicRecord, type ProjectedRecordRow } from "../public/serialize";
import { buildListQuery, type ListRow } from "../public/sql";
import { resolveTenantId } from "../public/tenant-resolver";
import { TENANT_SLUG_MAX_LENGTH, TENANT_SLUG_PATTERN } from "./tenants";

// design-spec §12.4〜12.7 / G3: 公開 read API。投影 D1（+ コントロールプレーン D1 と KV の
// テナント解決）だけを読み、DO は絶対に起こさない。認証なし（公開経路）。
// projection_tombstones は読まない: projected_records に行が無ければ見えない、が公開状態の全て。

// 型キーはプラグイン名前空間（blog.post）も通す。形が違うものは D1 を引かず 404
const TYPE_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/u;
// Finding 2（important）: 正規表現自体には長さ上限が無い（`*` は際限なく伸びる）ので、
// パターンとは別に上限を明示する。128 は実運用の型キー（プラグイン名前空間込みでも数十文字）に
// 十分な余裕。
const TYPE_KEY_MAX_LENGTH = 128;
const MAX_PARAM_LENGTH = 256;

function isValidTypeKey(type: string): boolean {
  return type.length <= TYPE_KEY_MAX_LENGTH && TYPE_KEY_PATTERN.test(type);
}

// Finding 2（important）: tenantSlug は createTenantSchema（routes/tenants.ts）が受理した形にしか
// 存在しえない。ここで同じ規則を通す前に弾けば、ゴミ slug の連打が KV get / コントロールプレーン
// D1 に一切届かない ―― 512B 超の slug をそのまま KV get に渡すと本番の KV は throw する（500 化）。
function isValidTenantSlug(slug: string): boolean {
  return slug.length <= TENANT_SLUG_MAX_LENGTH && TENANT_SLUG_PATTERN.test(slug);
}

interface SingleRow extends ProjectedRecordRow {
  publish_seq: number;
}

type PublicEnv = { Bindings: Env };

const SINGLE_COLUMNS = "record_id, type, slug, published_at, data, publish_seq";


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
    !isValidTypeKey(type) ||
    value.length === 0 ||
    value.length > MAX_PARAM_LENGTH ||
    value === "." ||
    value === ".."
  ) {
    return c.json({ error: "not_found" }, 404);
  }
  if (!isValidTenantSlug(tenantSlug)) {
    return c.json({ error: "unknown_tenant" }, 404);
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
        ...relationIds.get(row.record_id),
      },
    };
    const body =
      include.length > 0
        ? {
            ...base,
            included: await expandIncludes(
              c.env.PROJECTION_DB,
              tenantId,
              collectIncludeTargetIds(relationIds, include),
            ),
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
    if (!isValidTypeKey(type)) {
      return c.json({ error: "not_found" }, 404);
    }
    const tenantSlug = c.req.param("tenantSlug") ?? "";
    if (!isValidTenantSlug(tenantSlug)) {
      return c.json({ error: "unknown_tenant" }, 404);
    }
    const tenantId = await resolveTenantId(c.env, tenantSlug);
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
            ...relationIds.get(row.record_id),
          },
        };
      });
      const body: Record<string, unknown> = { items, nextCursor };
      if (query.include.length > 0) {
        body["included"] = await expandIncludes(
          c.env.PROJECTION_DB,
          tenantId,
          collectIncludeTargetIds(relationIds, query.include),
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
