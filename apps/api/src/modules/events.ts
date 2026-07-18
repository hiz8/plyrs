import { v7 as uuidv7 } from "uuid";
import { asWriteResult } from "../rpc-unwrap";
import { enabledModuleIds } from "./enablement";
import { handleModuleSyncJob } from "./redistribute";
import { MODULE_REGISTRY, type ModuleDefinition, type ModuleEventName } from "./registry";

// §9.6 の多重化 kind(outbox_sweep と同格のシステム kind)
export const MODULE_EVENTS_SWEEP = "module_events_sweep";

export interface ModuleEventRow {
  id: string;
  moduleId: string;
  event: ModuleEventName;
  recordId: string;
  typeKey: string;
}

export interface ModuleEventJob {
  kind: "module_event";
  eventId: string;
  tenantId: string;
  moduleId: string;
  event: ModuleEventName;
  recordId: string;
  typeKey: string;
}

// Task 13 で実装(型だけ先に確定): §4.2 の型定義再配布
export interface ModuleSyncJob {
  kind: "module_sync";
  tenantId: string;
  moduleId: string;
}

export interface ModuleRedistributeJob {
  kind: "module_redistribute";
  moduleId: string;
}

export type ModuleQueueJob = ModuleEventJob | ModuleSyncJob | ModuleRedistributeJob;

// §9.4 ステップ5: コミットと同一トランザクションで積む(呼び出し元が transactionSync 内で呼ぶ)。
// actor が module: のとき積まない = イベント連鎖は 1 段まで(2026-07-18 設計確定。無限ループの
// 構造的防止)。public:{id} の公開 write は通常どおり積む。
export function emitModuleEvents(
  sql: SqlStorage,
  newEventId: () => string,
  now: string,
  event: ModuleEventName,
  typeKey: string,
  recordId: string,
  actor: string,
  registry: Record<string, ModuleDefinition> = MODULE_REGISTRY,
): number {
  if (actor.startsWith("module:")) {
    return 0;
  }
  let inserted = 0;
  for (const moduleId of enabledModuleIds(sql)) {
    const subscription = registry[moduleId]?.events?.[event];
    if (subscription === undefined || !subscription.types.includes(typeKey)) {
      continue;
    }
    sql.exec(
      "INSERT INTO module_events (id, module_id, event, record_id, type, enqueued_at, sent) VALUES (?, ?, ?, ?, ?, ?, 0)",
      newEventId(),
      moduleId,
      event,
      recordId,
      typeKey,
      now,
    );
    inserted += 1;
  }
  return inserted;
}

interface RawModuleEventRow extends Record<string, SqlStorageValue> {
  id: string;
  module_id: string;
  event: string;
  record_id: string;
  type: string;
}

export function unsentModuleEvents(sql: SqlStorage, limit: number): ModuleEventRow[] {
  return sql
    .exec<RawModuleEventRow>(
      "SELECT id, module_id, event, record_id, type FROM module_events WHERE sent = 0 ORDER BY rowid LIMIT ?",
      limit,
    )
    .toArray()
    .map((row) => ({
      id: row.id,
      moduleId: row.module_id,
      event: row.event as ModuleEventName,
      recordId: row.record_id,
      typeKey: row.type,
    }));
}

export function markModuleEventSent(sql: SqlStorage, id: string): void {
  sql.exec("UPDATE module_events SET sent = 1 WHERE id = ?", id);
}

export function countUnsentModuleEvents(sql: SqlStorage): number {
  return sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM module_events WHERE sent = 0").one().n;
}

export function purgeSentModuleEvents(sql: SqlStorage): void {
  sql.exec("DELETE FROM module_events WHERE sent = 1");
}

// §9.4 ステップ6: consumer のディスパッチ。at-least-once なのでハンドラは冪等必須(§9.3)。
// throw は index.ts が retry() に写す。
export async function handleModuleJob(
  env: Env,
  job: ModuleQueueJob,
  registry: Record<string, ModuleDefinition> = MODULE_REGISTRY,
): Promise<void> {
  switch (job.kind) {
    case "module_event": {
      const subscription = registry[job.moduleId]?.events?.[job.event];
      if (subscription === undefined || !subscription.types.includes(job.typeKey)) {
        return; // 購読が消えた後の残メッセージは黙って ack
      }
      const doStub = env.TENANT_DO.get(env.TENANT_DO.idFromName(job.tenantId));
      await subscription.handle({
        env,
        tenantId: job.tenantId,
        recordId: job.recordId,
        typeKey: job.typeKey,
        newId: () => uuidv7(),
        writeRecord: async (typeKey, params) =>
          asWriteResult(await doStub.moduleWrite(job.tenantId, job.moduleId, typeKey, params)),
      });
      return;
    }
    case "module_sync":
    case "module_redistribute": {
      await handleModuleSyncJob(env, job);
      return;
    }
  }
}
