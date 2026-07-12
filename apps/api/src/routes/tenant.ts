import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { WORKFLOW_STATUSES } from "@plyrs/metamodel";
import { tenantGate, type GateVariables } from "../middleware/tenant-gate";
import {
  asContentTypeRow,
  asDeleteResult,
  asRecordSnapshot,
  asRegisterResult,
  asWriteResult,
} from "../rpc-unwrap";

const ERROR_STATUS: Record<string, ContentfulStatusCode> = {
  forbidden: 403,
  unknown_type: 404,
  not_found: 404,
  unique_violation: 409,
  id_mismatch: 409,
  key_mismatch: 409,
  record_deleted: 410,
  already_deleted: 410,
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
  });
