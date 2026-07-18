import type { ModuleRedistributeJob, ModuleSyncJob } from "./events";

// Task 13 で実装する(§4.2 の Queues 再配布)。それまでは到達しない。
export async function handleModuleSyncJob(
  _env: Env,
  job: ModuleSyncJob | ModuleRedistributeJob,
): Promise<void> {
  throw new Error(`module sync not implemented yet: ${job.kind}`);
}
