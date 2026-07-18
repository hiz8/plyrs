import { Hono } from "hono";
import { handleModuleJob, type ModuleQueueJob } from "./modules/events";
import { handleProjectionJob } from "./projection/consumer";
import type { ProjectionJob } from "./projection/jobs";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import { publicWriteRoutes } from "./routes/public-write";
import { tenantRoutes } from "./routes/tenant";
import { tenantAdminRoutes } from "./routes/tenants";

export { TenantDO } from "./tenant-do";

const app = new Hono<{ Bindings: Env }>();
app.route("/auth", authRoutes);
app.route("/v1/tenants", tenantAdminRoutes);
app.route("/v1/t", tenantRoutes);
// §11.7(論点W): 公開 write。publicRoutes(GET のみ)より前に置く — メソッドが違うため衝突しない。
// POST の 404 を read 側の notFound に食わせない順序。
app.route("/public/v1", publicWriteRoutes);
// design-spec §12: 公開 read（認証なし・DO 非経由・投影 D1 のみ）
app.route("/public/v1", publicRoutes);
app.notFound((c) => c.json({ error: "not_found" }, 404));

export { app };

export default {
  fetch: app.fetch,
  // design-spec §12.3 / Phase 9 §9.4: projection と module events の 2 キューを 1 ハンドラで
  // 受ける（wrangler.jsonc の consumers はどちらもこの queue() を指す）。冪等なので
  // at-least-once 配信をそのまま受ける。ExportedHandlerQueueHandler は ctx を第3引数として
  // 渡す（テストの worker.queue(batch, env, ctx) 呼び出しに対応）。
  async queue(
    batch: MessageBatch<ProjectionJob | ModuleQueueJob>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const nowMs = Date.now();
    for (const message of batch.messages) {
      try {
        if (batch.queue === "plyrs-modules") {
          // batch.queue で判別済み。メッセージ型はキューごとに閉じている(境界 cast)。
          await handleModuleJob(env, message.body as ModuleQueueJob);
        } else {
          await handleProjectionJob(env, message.body as ProjectionJob, nowMs);
        }
        message.ack();
      } catch (error) {
        console.error("queue job failed", batch.queue, message.body, error);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, ProjectionJob | ModuleQueueJob>;
