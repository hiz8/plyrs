import { Hono } from "hono";
import { cors } from "hono/cors";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { issuesToMessage } from "../do/content-types";
import { moduleById } from "../modules/registry";
import { verifyTurnstile } from "../modules/turnstile";
import { resolveTenantId } from "../public/tenant-resolver";
import { asWriteResult } from "../rpc-unwrap";

// design-spec §11.7(論点W): 公開 write は第1段(メンバーシップゲート)を持たない代わりに
// 濫用防止層(レート制限 → 入力検証 → Turnstile)を第1段の位置に置く。第2段は DO の
// modulePublicWrite(publicWriteTypes 宣言)。順序の意図: レート制限が最安・最前、
// 入力検証は Turnstile より前(siteverify の外部呼び出しをゴミ入力に浪費しない)。
const publicWriteBodySchema = z.object({
  turnstileToken: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
});

export const publicWriteRoutes = new Hono<{ Bindings: Env }>()
  .use(
    "/*",
    cors({ origin: "*", allowMethods: ["POST", "OPTIONS"], allowHeaders: ["content-type"] }),
  )
  .post("/:tenantSlug/modules/:moduleId/:endpoint", async (c) => {
    const module = moduleById(c.req.param("moduleId"));
    const endpoint = module?.publicEndpoints?.[c.req.param("endpoint")];
    if (module === undefined || endpoint === undefined) {
      return c.json({ error: "not_found" }, 404);
    }
    const limiter = c.env.PUBLIC_WRITE_LIMITER;
    const secret = c.env.TURNSTILE_SECRET_KEY;
    if (limiter === undefined || secret === undefined || secret === "") {
      // 濫用防止層が構成されていない公開 write は開かない(JWT_SECRET と同じ fail-closed 思想)
      return c.json({ error: "misconfigured" }, 503);
    }
    const tenantId = await resolveTenantId(c.env, c.req.param("tenantSlug"));
    if (tenantId === null) {
      return c.json({ error: "unknown_tenant" }, 404);
    }
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const { success: withinLimit } = await limiter.limit({ key: `pubwrite:${tenantId}:${ip}` });
    if (!withinLimit) {
      return c.json({ error: "rate_limited" }, 429);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const body = publicWriteBodySchema.safeParse(raw);
    if (!body.success) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const input = endpoint.inputSchema.safeParse(body.data.input);
    if (!input.success) {
      return c.json(
        { error: "validation_failed", message: issuesToMessage(input.error.issues) },
        400,
      );
    }
    const human = await verifyTurnstile(
      secret,
      body.data.turnstileToken,
      c.req.header("cf-connecting-ip") ?? null,
    );
    if (!human) {
      return c.json({ error: "turnstile_failed" }, 403);
    }
    const write = endpoint.buildWrite(input.data, { newId: () => uuidv7() });
    const stub = c.env.TENANT_DO.get(c.env.TENANT_DO.idFromName(tenantId));
    const result = asWriteResult(
      await stub.modulePublicWrite(tenantId, module.manifest.moduleId, endpoint.typeKey, write),
    );
    if (!result.ok) {
      // モジュール名前空間コード(例 booking:slot_full)は業務上の競合 = 409。
      // システム語彙は管理 API と同じ対応(forbidden 403 / validation 400)に落とす。
      const status = result.code.includes(":") ? 409 : result.code === "forbidden" ? 403 : 400;
      return c.json({ ok: false, code: result.code, message: result.message }, status);
    }
    return c.json({ ok: true, recordId: result.record.id }, 201);
  });
