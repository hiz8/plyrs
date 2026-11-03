import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import { ASSET_TYPE_KEY, WORKFLOW_STATUSES } from "@plyrs/metamodel";
import { sniffImageSize } from "../assets/image-size";
import { assetKeyBelongsToTenant } from "../assets/ownership";
import { can } from "../auth/permissions";
import { authenticateTenantToken, tenantGate, type GateVariables } from "../middleware/tenant-gate";
import { findOperation } from "../ops/catalog";
import {
  asAssetUsage,
  asContentTypeRow,
  asContentTypeRows,
  asDeleteContentTypeResult,
  asEnableModuleResult,
  asInvokeResult,
  asModuleSummaries,
  asOrphanIds,
  asPublicationState,
  asPublicationsPage,
  asRecordSnapshot,
  asRegisterResult,
  asReprojectResult,
  asWriteResult,
} from "../rpc-unwrap";
import { tenantSettingsRoutes } from "./tenant-settings";
import { tenantTokensRoutes } from "./tenant-tokens";
import { AUTH_HEADER, extractTokenProtocol } from "../sync/session";

const ERROR_STATUS: Record<string, ContentfulStatusCode> = {
  forbidden: 403,
  unknown_type: 404,
  unknown_module: 404,
  not_found: 404,
  unique_violation: 409,
  id_mismatch: 409,
  key_mismatch: 409,
  type_conflict: 409,
  type_not_empty: 409,
  record_deleted: 410,
  already_deleted: 410,
  not_published: 409,
  // M2-4: 操作カタログ(invoke)の失敗コード(16.7)
  conflict: 409,
  already_exists: 409,
  insufficient_scope: 403,
  unknown_operation: 404,
  invalid_input: 400,
  unsupported_markdown: 400,
};

function statusFor(code: string): ContentfulStatusCode {
  const mapped = ERROR_STATUS[code];
  if (mapped !== undefined) {
    return mapped;
  }
  // §15-4: モジュール拒否コード(`moduleId:reason`、例 booking:slot_full)は公開 write(409)と
  // 揃える。公開 write 側(public-write.ts)は ':' 含みを一律 409 として扱っており、管理 API だけ
  // 既定 400 のままだと同じ拒否理由なのに経路でステータスが割れる。
  // Minor 掃除(§16-2)引き継ぎ事項: この判定は「':' を含むか」だけを見る部分文字列チェックで、
  // moduleId が MODULE_REGISTRY に実在するかまでは検証しない(実際に ':' 付きコードを
  // 返すのは現状 booking モジュールのみ — module-flow.test.ts の
  // 「管理 API 経由の booking:slot_full は 409 を返す」が現行挙動を固定)。狭める効用より
  // 挙動変更のリスクが上回るため、意図的にこのまま残す。
  return code.includes(":") ? 409 : 400;
}

const writeBodySchema = z.object({
  input: z.record(z.string(), z.unknown()),
  status: z.enum(WORKFLOW_STATUSES).optional(),
  // M2-7b: 更新(record がある)ときは必須。欠けは invoke(record_update)の入力検証が 400 にする
  changedFields: z.array(z.string().min(1)).optional(),
  baseFieldVersions: z.record(z.string(), z.number().int().nonnegative()).optional(),
});

// Phase 8 決定 1: Worker 経由 PUT。CMS の画像用途に十分な上限(動画等の大容量は非目標)。
const MAX_ASSET_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_ASSET_FILENAME_LENGTH = 256;
const MAX_ASSET_CONTENT_TYPE_LENGTH = 256; // asset 型の content_type フィールド maxLength と一致
// 公開状態一覧の 1 ページの上限(既定値も兼ねる)。1 行は 100 バイト前後なので 1 ページ 100KB 程度
const MAX_PUBLICATIONS_LIMIT = 1000;

type GateEnv = { Bindings: Env; Variables: GateVariables };

function stubFor(c: { env: Env; req: { param: (key: "tenantId") => string } }) {
  // design-spec §2: テナント = 1 DO。tenantId がそのまま DO 名（＝物理分離の境界）
  const id = c.env.TENANT_DO.idFromName(c.req.param("tenantId"));
  return c.env.TENANT_DO.get(id);
}

// Phase 9: 有効化状態の control-plane ミラー(正本は DO)。再配布(§4.2)の宛先列挙用。
// best-effort — 失敗しても DO 側は確定しており、起床時の遅延適用が安全網になる。
async function mirrorTenantModule(
  env: Env,
  tenantId: string,
  moduleId: string,
  enabled: boolean,
): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO tenant_modules (tenant_id, module_id, enabled, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, module_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at",
    )
      .bind(tenantId, moduleId, enabled ? 1 : 0, new Date().toISOString())
      .run();
  } catch (error) {
    console.error("tenant_modules mirror failed", tenantId, moduleId, error);
  }
}

export const tenantRoutes = new Hono<GateEnv>()
  // WS upgrade は Authorization ヘッダを持てないため tenantGate の外に置き、
  // 同じ検証コア（authenticateTenantToken）を subprotocol のトークンで呼ぶ。
  .get("/:tenantId/sync", async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: "expected_websocket" }, 426);
    }
    const token = extractTokenProtocol(c.req.header("sec-websocket-protocol"));
    if (token === null) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    const result = await authenticateTenantToken(c.env, c.req.param("tenantId"), token);
    if (!result.ok) {
      return c.json({ error: result.failure.code }, result.failure.status);
    }
    const forwarded = new Request(c.req.raw, { headers: new Headers(c.req.raw.headers) });
    forwarded.headers.set(AUTH_HEADER, JSON.stringify(result.auth));
    return stubFor(c).fetch(forwarded);
  })
  .use("/:tenantId/*", tenantGate)
  .route("/", tenantSettingsRoutes)
  // M1-3a: PAT の発行・一覧・失効(design-spec 16.3)
  .route("/", tenantTokensRoutes)
  .post("/:tenantId/assets", async (c) => {
    const filename = c.req.query("filename") ?? "";
    if (filename.length === 0 || filename.length > MAX_ASSET_FILENAME_LENGTH) {
      return c.json({ error: "invalid_filename" }, 400);
    }
    // Content-Length を先に見て巨大 body の読み込み自体を避ける(fail fast)。
    const declared = Number(c.req.header("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_ASSET_SIZE_BYTES) {
      return c.json({ error: "too_large" }, 413);
    }
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) {
      return c.json({ error: "empty_body" }, 400);
    }
    if (body.byteLength > MAX_ASSET_SIZE_BYTES) {
      return c.json({ error: "too_large" }, 413);
    }
    const contentType = c.req.header("content-type") ?? "application/octet-stream";
    // §14 Minor 消化: R2 put の前に役割を検証する(viewer の put → best-effort delete という
    // 無駄な往復と、delete 失敗時の孤児バイナリを構造的に無くす)。DO 側の requireOperation は
    // 防御の二層目としてそのまま残る。
    if (!can(c.get("auth").role, "record:write")) {
      return c.json({ ok: false, code: "forbidden", message: "role cannot upload assets" }, 403);
    }
    const tenantId = c.req.param("tenantId");
    // ID はサーバー生成(uuidv7)。r2_key は `${tenantId}/${assetId}` 規約 — バイナリは不変
    // (差し替えは新しい asset)。寸法はサーバー側スニファで導出(クライアント申告を信用しない)。
    const assetId = uuidv7();
    const r2Key = `${tenantId}/${assetId}`;
    const dimensions = sniffImageSize(new Uint8Array(body));
    await c.env.ASSETS.put(r2Key, body);
    const result = asWriteResult(
      await stubFor(c).createAssetRecord(
        {
          recordId: assetId,
          input: {
            filename,
            content_type: contentType.slice(0, MAX_ASSET_CONTENT_TYPE_LENGTH),
            size: body.byteLength,
            r2_key: r2Key,
            ...(dimensions === null ? {} : { width: dimensions.width, height: dimensions.height }),
          },
        },
        c.get("auth"),
      ),
    );
    if (!result.ok) {
      // メタデータ作成に失敗したバイナリは孤児になるため片付ける(best-effort —
      // 失敗した孤児は Phase 10 の R2 GC 候補)。
      try {
        await c.env.ASSETS.delete(r2Key);
      } catch {
        console.error("orphan R2 object left behind", r2Key);
      }
      return c.json(result, statusFor(result.code));
    }
    return c.json(result, 201);
  })
  // Phase 8 決定 6: リテラル "orphans" が :assetId として捕捉されないよう、
  // 上記アップロードルートより前・:assetId 系ルートより前に置く。
  .get("/:tenantId/assets/orphans", async (c) => {
    const orphanIds = asOrphanIds(await stubFor(c).listAssetOrphanIds());
    return c.json({ orphanIds });
  })
  // 管理画面のプレビュー配信(認証付き)。未 publish の asset を表示するための経路で、
  // 公開配信(/public/v1/.../assets/:assetId — Task 8)とはゲートが違う。
  .get("/:tenantId/assets/:assetId/file", async (c) => {
    const record = asRecordSnapshot(await stubFor(c).getRecord(c.req.param("assetId")));
    if (record === null || record.deletedAt !== null || record.type !== ASSET_TYPE_KEY) {
      return c.json({ error: "not_found" }, 404);
    }
    const r2Key = record.data["r2_key"];
    // 最終レビュー指摘: assetGuardHook が働かないテナント(ownership.ts 冒頭コメント参照)では
    // r2_key が任意の値になりうるため、ASSETS.get の前に必ずテナント所有権を確認する。
    if (typeof r2Key !== "string" || !assetKeyBelongsToTenant(r2Key, c.req.param("tenantId"))) {
      return c.json({ error: "not_found" }, 404);
    }
    const object = await c.env.ASSETS.get(r2Key);
    if (object === null) {
      return c.json({ error: "not_found" }, 404);
    }
    const contentType = record.data["content_type"];
    return new Response(object.body, {
      headers: {
        "content-type": typeof contentType === "string" ? contentType : "application/octet-stream",
        "cache-control": "private, no-store",
        // ユーザー投稿バイナリを同一オリジンで inline 表示するための封じ込め(SVG 内スクリプト等)
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  })
  .get("/:tenantId/assets/:assetId/usage", async (c) => {
    const usage = asAssetUsage(await stubFor(c).listAssetUsage(c.req.param("assetId")));
    return c.json({ usage });
  })
  .put("/:tenantId/content-types", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const result = asRegisterResult(await stubFor(c).registerContentType(body, c.get("auth")));
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  })
  .get("/:tenantId/content-types", async (c) => {
    const rows = asContentTypeRows(await stubFor(c).listContentTypes());
    return c.json({ contentTypes: rows });
  })
  // 案 E 5.4: コンテンツが 0 件のユーザー型だけを削除できる(1 件以上は 409 type_not_empty)
  .delete("/:tenantId/content-types/:key", async (c) => {
    const result = asDeleteContentTypeResult(
      await stubFor(c).deleteContentType(c.req.param("key"), c.get("auth")),
    );
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  })
  .get("/:tenantId/content-types/:key", async (c) => {
    const row = asContentTypeRow(await stubFor(c).getContentType(c.req.param("key")));
    return row === null ? c.json({ error: "not_found" }, 404) : c.json(row);
  })
  // 16.4(M2-4): 操作カタログの REST の生成面。body は操作の input そのまま。via に rest を含む操作だけ
  // 受ける(MCP 専用の操作は 404)。needsTenantSlug の操作だけ D1 から slug を引く(publish ルートと同じ 1 照会)
  .post("/:tenantId/ops/:op", async (c) => {
    const name = c.req.param("op");
    const spec = findOperation(name);
    if (spec === undefined || !spec.via.includes("rest")) {
      return c.json(
        { ok: false, code: "unknown_operation", message: `unknown operation: ${name}` },
        404,
      );
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, code: "invalid_input", message: "body must be JSON" }, 400);
    }
    let tenantSlug: string | undefined;
    if (spec.needsTenantSlug === true) {
      const slugRow = await c.env.DB.prepare("SELECT slug FROM tenants WHERE id = ?")
        .bind(c.req.param("tenantId"))
        .first<{ slug: string }>();
      if (slugRow === null) {
        return c.json({ ok: false, code: "not_found", message: "tenant not found" }, 404);
      }
      tenantSlug = slugRow.slug;
    }
    const result = asInvokeResult(
      await stubFor(c).invoke(
        name,
        body,
        c.get("auth"),
        tenantSlug === undefined ? {} : { tenantSlug },
      ),
    );
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  })
  // 16.4 / 16.6(M2-7b): record の書き込みは操作カタログへ流す。record が無ければ record_create、
  // あれば record_update(baseFieldVersions 必須。無ければ invoke が invalid_input = 400 を返す)。
  // 応答の形は従来の { ok, record } を保つ
  .put("/:tenantId/records/:typeKey/:recordId", zValidator("json", writeBodySchema), async (c) => {
    const body = c.req.valid("json");
    const recordId = c.req.param("recordId");
    const existing = asRecordSnapshot(await stubFor(c).getRecord(recordId));
    const result = asInvokeResult(
      existing === null
        ? await stubFor(c).invoke(
            "record_create",
            {
              type: c.req.param("typeKey"),
              recordId,
              input: body.input,
              ...(body.status ? { status: body.status } : {}),
            },
            c.get("auth"),
          )
        : await stubFor(c).invoke(
            "record_update",
            {
              recordId,
              input: body.input,
              ...(body.changedFields === undefined ? {} : { changedFields: body.changedFields }),
              ...(body.baseFieldVersions === undefined
                ? {}
                : { baseFieldVersions: body.baseFieldVersions }),
              ...(body.status ? { status: body.status } : {}),
            },
            c.get("auth"),
          ),
    );
    return result.ok
      ? c.json({ ok: true, record: result.output })
      : c.json(result, statusFor(result.code));
  })
  // 案 D 9 章: 一覧・ホームが公開状態をレコード 1 件ずつ取らずに済むよう、型ごと(省略で全型)にまとめて返す。
  // 1 応答の大きさと DO の占有時間を抑えるため record_id カーソルでページングする
  .get("/:tenantId/publications", async (c) => {
    const limitParam = c.req.query("limit");
    let limit = MAX_PUBLICATIONS_LIMIT;
    if (limitParam !== undefined) {
      limit = /^\d{1,4}$/u.test(limitParam) ? Number(limitParam) : 0;
      if (limit < 1 || limit > MAX_PUBLICATIONS_LIMIT) {
        return c.json({ error: "bad_limit" }, 400);
      }
    }
    const page = asPublicationsPage(
      await stubFor(c).listPublications({
        type: c.req.query("type"),
        cursor: c.req.query("cursor") ?? null,
        limit,
      }),
    );
    return c.json(page);
  })
  .get("/:tenantId/records/:recordId/publication", async (c) => {
    const state = asPublicationState(await stubFor(c).getPublication(c.req.param("recordId")));
    return c.json(state);
  })
  .get("/:tenantId/records/:recordId", async (c) => {
    const record = asRecordSnapshot(await stubFor(c).getRecord(c.req.param("recordId")));
    return record === null ? c.json({ error: "not_found" }, 404) : c.json(record);
  })
  .delete("/:tenantId/records/:recordId", async (c) => {
    const recordId = c.req.param("recordId");
    // M2-7b: 削除は record_delete(冪等。削除済みでも ok)。応答の形は従来の { ok, record } を保つ
    const result = asInvokeResult(
      await stubFor(c).invoke("record_delete", { recordId }, c.get("auth")),
    );
    if (!result.ok) {
      return c.json(result, statusFor(result.code));
    }
    const record = asRecordSnapshot(await stubFor(c).getRecord(recordId));
    // Phase 8: asset の削除はバイナリも片付ける(best-effort — 失敗した孤児は Phase 10 の
    // GC 候補。同期 push 経由の削除はここを通らないため孤児が残る — 引き継ぎ事項に記録済み)。
    if (record !== null && record.type === ASSET_TYPE_KEY) {
      const r2Key = record.data["r2_key"];
      // 最終レビュー指摘: 他テナント接頭辞の r2_key は削除しない(ownership.ts 冒頭コメント参照)。
      // 該当しない場合はレコード削除自体はそのまま成立させ、R2 側の片付けだけをスキップする。
      if (typeof r2Key === "string" && assetKeyBelongsToTenant(r2Key, c.req.param("tenantId"))) {
        try {
          await c.env.ASSETS.delete(r2Key);
        } catch {
          console.error("failed to delete R2 object for asset", recordId);
        }
      }
    }
    return c.json({ ok: true, record });
  })
  .post("/:tenantId/records/:recordId/publish", async (c) => {
    // Phase 8 決定 4: アセットの埋め込み URL は公開パス(/public/v1/:tenantSlug/...)を指す。
    // slug の正本はコントロールプレーン D1(publish は低頻度なので 1 クエリを許容)。
    const tenantId = c.req.param("tenantId");
    const slugRow = await c.env.DB.prepare("SELECT slug FROM tenants WHERE id = ?")
      .bind(tenantId)
      .first<{ slug: string }>();
    if (slugRow === null) {
      return c.json({ error: "unknown_tenant" }, 404);
    }
    // M2-7b: record_publish(冪等。同じ版の再 publish は何も書かない)
    const result = asInvokeResult(
      await stubFor(c).invoke(
        "record_publish",
        { recordId: c.req.param("recordId") },
        c.get("auth"),
        { tenantSlug: slugRow.slug },
      ),
    );
    return result.ok
      ? c.json({ ok: true, snapshot: result.output })
      : c.json(result, statusFor(result.code));
  })
  .post("/:tenantId/records/:recordId/unpublish", async (c) => {
    // M2-7b: record_unpublish(未公開なら ok、sourceVersion は null)
    const result = asInvokeResult(
      await stubFor(c).invoke(
        "record_unpublish",
        { recordId: c.req.param("recordId") },
        c.get("auth"),
      ),
    );
    return result.ok
      ? c.json({ ok: true, ...(result.output as Record<string, unknown>) })
      : c.json(result, statusFor(result.code));
  })
  .post("/:tenantId/reproject", async (c) => {
    const result = asReprojectResult(
      await stubFor(c).startReprojection(c.req.param("tenantId"), c.get("auth")),
    );
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  })
  .get("/:tenantId/modules", async (c) => {
    const modules = asModuleSummaries(await stubFor(c).listModules());
    return c.json({ modules });
  })
  .post("/:tenantId/modules/:moduleId/enable", async (c) => {
    const tenantId = c.req.param("tenantId");
    const result = asEnableModuleResult(
      await stubFor(c).enableModule(tenantId, c.req.param("moduleId"), c.get("auth")),
    );
    if (result.ok) {
      await mirrorTenantModule(c.env, tenantId, result.module.moduleId, true);
      return c.json(result);
    }
    return c.json(result, statusFor(result.code));
  })
  .post("/:tenantId/modules/:moduleId/disable", async (c) => {
    const tenantId = c.req.param("tenantId");
    const result = asEnableModuleResult(
      await stubFor(c).disableModule(tenantId, c.req.param("moduleId"), c.get("auth")),
    );
    if (result.ok) {
      await mirrorTenantModule(c.env, tenantId, result.module.moduleId, false);
      return c.json(result);
    }
    return c.json(result, statusFor(result.code));
  });
