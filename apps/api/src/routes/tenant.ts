import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { WORKFLOW_STATUSES } from "@plyrs/metamodel";
import { authenticateTenantToken, tenantGate, type GateVariables } from "../middleware/tenant-gate";
import {
  asContentTypeRow,
  asContentTypeRows,
  asDeleteResult,
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
  not_found: 404,
  unique_violation: 409,
  id_mismatch: 409,
  key_mismatch: 409,
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

type GateEnv = { Bindings: Env; Variables: GateVariables };

function stubFor(c: { env: Env; req: { param: (key: "tenantId") => string } }) {
  // design-spec §2: テナント = 1 DO。tenantId がそのまま DO 名（＝物理分離の境界）
  const id = c.env.TENANT_DO.idFromName(c.req.param("tenantId"));
  return c.env.TENANT_DO.get(id);
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
  .get("/:tenantId/records/:recordId", async (c) => {
    const record = asRecordSnapshot(await stubFor(c).getRecord(c.req.param("recordId")));
    return record === null ? c.json({ error: "not_found" }, 404) : c.json(record);
  })
  .delete("/:tenantId/records/:recordId", async (c) => {
    const result = asDeleteResult(
      await stubFor(c).deleteRecord(c.req.param("recordId"), c.get("auth")),
    );
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  })
  .post("/:tenantId/records/:recordId/publish", async (c) => {
    const result = asPublishResult(
      await stubFor(c).publishRecord(
        c.req.param("tenantId"),
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
  });
