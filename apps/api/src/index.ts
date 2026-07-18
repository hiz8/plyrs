import { Hono } from "hono";
import { purgeExpiredSessions } from "./auth/session";
import { requireSaneSecret } from "./middleware/sane-secret";
import { handleModuleJob, type ModuleQueueJob } from "./modules/events";
import { parkDeadLetter } from "./ops/dead-letters";
import { handleProjectionJob } from "./projection/consumer";
import type { ProjectionJob } from "./projection/jobs";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import { publicWriteRoutes } from "./routes/public-write";
import { superAuthRoutes } from "./routes/super-auth";
import { superRoutes } from "./routes/super";
import { tenantRoutes } from "./routes/tenant";

export { TenantDO } from "./tenant-do";

const app = new Hono<{ Bindings: Env }>();
// §6: JWT_SECRET が短い(設定事故)場合は認証・テナント系を丸ごと fail-closed で閉じる。
// /super-auth・/super/v1 も同じガード配下(super セッションは JWT を使わないが、設定事故時は
// 道連れで閉じる)。
app.use("/auth/*", requireSaneSecret);
app.use("/v1/*", requireSaneSecret);
app.use("/super-auth/*", requireSaneSecret);
app.use("/super/v1/*", requireSaneSecret);
app.route("/auth", authRoutes);
// 裁定 9: self-serve テナント作成(旧 POST /v1/tenants)は撤去。作成は /super/v1/tenants 専用。
app.route("/v1/t", tenantRoutes);
app.route("/super-auth", superAuthRoutes);
app.route("/super/v1", superRoutes);
// §11.7(論点W): 公開 write。publicRoutes(GET のみ)より前に置く — メソッドが違うため衝突しない。
// POST の 404 を read 側の notFound に食わせない順序。
app.route("/public/v1", publicWriteRoutes);
// design-spec §12: 公開 read（認証なし・DO 非経由・投影 D1 のみ）
app.route("/public/v1", publicRoutes);
app.notFound((c) => c.json({ error: "not_found" }, 404));

export { app };

export default {
  fetch: app.fetch,
  // §6: 期限切れ・失効済みセッションの日次掃除(wrangler.jsonc の triggers.crons が起動する)。
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await purgeExpiredSessions(env.DB, new Date());
  },
  // design-spec §12.3 / Phase 9 §9.4: projection と module events の 2 キューを 1 ハンドラで
  // 受ける（wrangler.jsonc の consumers はどちらもこの queue() を指す）。冪等なので
  // at-least-once 配信をそのまま受ける。ExportedHandlerQueueHandler は ctx を第3引数として
  // 渡す（テストの worker.queue(batch, env, ctx) 呼び出しに対応）。
  async queue(
    batch: MessageBatch<ProjectionJob | ModuleQueueJob>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    if (batch.queue.endsWith("-dlq")) {
      // DLQ consumer: D1 に退避できたものだけ ack する。insert 失敗は retry
      // (DLQ の DLQ は無い — max_retries 10 を使い切ると喪失するリスクは許容し console.error に残す)。
      for (const message of batch.messages) {
        try {
          await parkDeadLetter(env, batch.queue, { id: message.id, body: message.body });
          message.ack();
        } catch (error) {
          console.error("dlq park failed", batch.queue, error);
          message.retry();
        }
      }
      return;
    }
    const nowMs = Date.now();
    for (const message of batch.messages) {
      try {
        if (batch.queue.startsWith("plyrs-modules")) {
          // env サフィックス(plyrs-modules-preview 等)でも module キューとして扱う(Task 15 の命名規約)。
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
