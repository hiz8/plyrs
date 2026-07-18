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
import {
  asAssetUsage,
  asContentTypeRow,
  asContentTypeRows,
  asDeleteResult,
  asEnableModuleResult,
  asModuleSummaries,
  asOrphanIds,
  asPublicationState,
  asPublishResult,
  asRecordSnapshot,
  asRegisterResult,
  asReprojectResult,
  asUnpublishResult,
  asWriteResult,
} from "../rpc-unwrap";
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
  record_deleted: 410,
  already_deleted: 410,
  not_published: 409,
};

function statusFor(code: string): ContentfulStatusCode {
  return ERROR_STATUS[code] ?? 400;
}

const writeBodySchema = z.object({
  input: z.record(z.string(), z.unknown()),
  status: z.enum(WORKFLOW_STATUSES).optional(),
});

// Phase 8 裁定 1: Worker 経由 PUT。CMS の画像用途に十分な上限(動画等の大容量は非目標)。
const MAX_ASSET_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_ASSET_FILENAME_LENGTH = 256;
const MAX_ASSET_CONTENT_TYPE_LENGTH = 256; // asset 型の content_type フィールド maxLength と一致

type GateEnv = { Bindings: Env; Variables: GateVariables };

function stubFor(c: { env: Env; req: { param: (key: "tenantId") => string } }) {
  // design-spec §2: テナント = 1 DO。tenantId がそのまま DO 名（＝物理分離の境界）
  const id = c.env.TENANT_DO.idFromName(c.req.param("tenantId"));
  return c.env.TENANT_DO.get(id);
}

// Phase 9: 有効化状態の control-plane ミラー(真実源は DO)。再配布(§4.2)の宛先列挙用。
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
  // Phase 8 裁定 6: リテラル "orphans" が :assetId として捕捉されないよう、
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
  .get("/:tenantId/content-types/:key", async (c) => {
    const row = asContentTypeRow(await stubFor(c).getContentType(c.req.param("key")));
    return row === null ? c.json({ error: "not_found" }, 404) : c.json(row);
  })
  .put("/:tenantId/records/:typeKey/:recordId", zValidator("json", writeBodySchema), async (c) => {
    const { input, status } = c.req.valid("json");
    const result = asWriteResult(
      await stubFor(c).writeRecord(
        c.req.param("typeKey"),
        { recordId: c.req.param("recordId"), input, ...(status ? { status } : {}) },
        c.get("auth"),
      ),
    );
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
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
    const result = asDeleteResult(
      await stubFor(c).deleteRecord(c.req.param("recordId"), c.get("auth")),
    );
    // Phase 8: asset の削除はバイナリも片付ける(best-effort — 失敗した孤児は Phase 10 の
    // GC 候補。同期 push 経由の削除はここを通らないため孤児が残る — 申し送りに記録済み)。
    if (result.ok && result.record.type === ASSET_TYPE_KEY) {
      const r2Key = result.record.data["r2_key"];
      // 最終レビュー指摘: 他テナント接頭辞の r2_key は削除しない(ownership.ts 冒頭コメント参照)。
      // 該当しない場合はレコード削除自体はそのまま成立させ、R2 側の片付けだけをスキップする。
      if (typeof r2Key === "string" && assetKeyBelongsToTenant(r2Key, c.req.param("tenantId"))) {
        try {
          await c.env.ASSETS.delete(r2Key);
        } catch {
          console.error("failed to delete R2 object for asset", result.record.id);
        }
      }
    }
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  })
  .post("/:tenantId/records/:recordId/publish", async (c) => {
    // Phase 8 裁定 4: 凍結 embed URL は公開パス(/public/v1/:tenantSlug/...)を指す。
    // slug の真実源はコントロールプレーン D1(publish は低頻度なので 1 クエリを許容)。
    const tenantId = c.req.param("tenantId");
    const slugRow = await c.env.DB.prepare("SELECT slug FROM tenants WHERE id = ?")
      .bind(tenantId)
      .first<{ slug: string }>();
    if (slugRow === null) {
      return c.json({ error: "unknown_tenant" }, 404);
    }
    const result = asPublishResult(
      await stubFor(c).publishRecord(
        tenantId,
        slugRow.slug,
        c.req.param("recordId"),
        c.get("auth"),
      ),
    );
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  })
  .post("/:tenantId/records/:recordId/unpublish", async (c) => {
    const result = asUnpublishResult(
      await stubFor(c).unpublishRecord(
        c.req.param("tenantId"),
        c.req.param("recordId"),
        c.get("auth"),
      ),
    );
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
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
