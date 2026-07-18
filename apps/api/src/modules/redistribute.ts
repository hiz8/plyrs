import type { ModuleRedistributeJob, ModuleSyncJob } from "./events";

// design-spec §4.2: モジュール更新時、コントロールプレーンが有効化テナントごとに
// マイグレーションジョブを Queues で配信する。redistribute は D1 ミラー(tenant_modules)から
// 宛先を列挙して module_sync をファンアウトし、sync は各テナント DO へ冪等適用する。
// トリガー(誰がいつ redistribute を積むか)は Phase 10 の特権テナント運用面の責務。
export async function handleModuleSyncJob(
  env: Env,
  job: ModuleSyncJob | ModuleRedistributeJob,
): Promise<void> {
  if (job.kind === "module_sync") {
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(job.tenantId));
    const result = (await stub.applyModuleManifest(job.moduleId)) as
      | { ok: true; applied: boolean }
      | { ok: false; code: string; message: string }; // RPC 境界の型戻し(rpc-unwrap 様式)
    if (!result.ok) {
      throw new Error(`module sync failed: ${result.message}`); // retry へ
    }
    return;
  }
  const rows = await env.DB.prepare(
    "SELECT tenant_id FROM tenant_modules WHERE module_id = ? AND enabled = 1",
  )
    .bind(job.moduleId)
    .all<{ tenant_id: string }>();
  for (const row of rows.results) {
    await env.MODULES_QUEUE.send({
      kind: "module_sync",
      tenantId: row.tenant_id,
      moduleId: job.moduleId,
    });
  }
}
