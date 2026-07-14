import { Hono } from "hono";
import { handleProjectionJob } from "./projection/consumer";
import type { ProjectionJob } from "./projection/jobs";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import { tenantRoutes } from "./routes/tenant";
import { tenantAdminRoutes } from "./routes/tenants";

export { TenantDO } from "./tenant-do";

const app = new Hono<{ Bindings: Env }>();
app.route("/auth", authRoutes);
app.route("/v1/tenants", tenantAdminRoutes);
app.route("/v1/t", tenantRoutes);
// design-spec §12: 公開 read（認証なし・DO 非経由・投影 D1 のみ）
app.route("/public/v1", publicRoutes);
app.notFound((c) => c.json({ error: "not_found" }, 404));

export { app };

export default {
  fetch: app.fetch,
  // design-spec §12.3: 投影 consumer。冪等なので at-least-once 配信をそのまま受ける。
  // ExportedHandlerQueueHandler は ctx を第3引数として渡す（テストの worker.queue(batch, env, ctx) 呼び出しに対応）。
  async queue(batch: MessageBatch<ProjectionJob>, env: Env, _ctx: ExecutionContext): Promise<void> {
    const nowMs = Date.now();
    for (const message of batch.messages) {
      try {
        await handleProjectionJob(env, message.body, nowMs);
        message.ack();
      } catch (error) {
        console.error("projection job failed", message.body, error);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, ProjectionJob>;
