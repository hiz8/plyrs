import { env, runInDurableObject } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it } from "vitest";
import { auditLogs, tenantModules } from "@plyrs/db/control-plane";
import { app } from "../src/index";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asModuleSummaries, asPublishResult } from "./rpc-unwrap";
import { resetSuperAdmins, superEnv, superLogin } from "./super-login";

// Queue の配送は非同期（miniflare のブローカ経由）。フラッシュ API は無いのでポーリングする
// (dead-letters.test.ts / projection-e2e.test.ts と同じ様式)。
async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for the condition");
    }
    await scheduler.wait(25);
  }
}

function jsonReq(method: string, path: string, cookie: string, body?: unknown): Request {
  return new Request(`https://api.test${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function auditActions(): Promise<string[]> {
  return (await drizzle(env.DB).select({ action: auditLogs.action }).from(auditLogs)).map(
    (row) => row.action,
  );
}

// tenant_modules を direct insert したテストは afterEach で必ず戻す(module-flow.test.ts と
// 同じ規律 — 共有 D1 の再配布 fanout テストは特にリークに脆い。Phase 9 §15 の既知事項)。
let cleanupTenantModule: { tenantId: string; moduleId: string } | undefined;

afterEach(async () => {
  await resetSuperAdmins();
  if (cleanupTenantModule !== undefined) {
    const { tenantId, moduleId } = cleanupTenantModule;
    await drizzle(env.DB)
      .delete(tenantModules)
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, moduleId)));
    cleanupTenantModule = undefined;
  }
});

describe("super operational triggers", () => {
  it("starts a reprojection with a synthetic super auth context", async () => {
    const { cookie } = await superLogin();
    const e = superEnv();
    const tenantId = crypto.randomUUID();
    const stub = e.TENANT_DO.get(e.TENANT_DO.idFromName(tenantId));
    const recordId = uuid(1700);

    // テナント + 型 + record + publish(既存ヘルパ、reproject.test.ts と同じ経路)。
    await stub.registerContentType(articleType(), auth("owner1"));
    await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1"));
    const published = asPublishResult(
      await stub.publishRecord(tenantId, tenantId, recordId, auth("owner1")),
    );
    expect(published.ok).toBe(true);

    // publish の自然な排出（outbox → queue → projection、実ブローカ経由）を待ち、
    // 投影が一度出来上がった状態からスタートする。
    await waitFor(() =>
      env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>(),
    );

    // 投影行の消失（手動介入・障害等）を再現する。super の reproject トリガーで復元できることを確認する。
    await env.PROJECTION_DB.prepare(
      "DELETE FROM projected_records WHERE tenant_id = ? AND record_id = ?",
    )
      .bind(tenantId, recordId)
      .run();
    expect(
      await env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>(),
    ).toBeNull();

    const response = await app.request(
      jsonReq("POST", `/super/v1/tenants/${tenantId}/reproject`, cookie),
      undefined,
      e,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: true; epoch: number };
    expect(body.ok).toBe(true);
    expect(typeof body.epoch).toBe("number");

    // 実 miniflare ブローカ経由で reproject ジョブが projection consumer へ届き、
    // 投影が復元されるまでポーリングで観測する(dead-letters.test.ts と同じ様式)。
    await waitFor(() =>
      env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>(),
    );

    expect(await auditActions()).toContain("reproject.start");
  });

  it("enqueues a module redistribute and fans out to enabled tenants", async () => {
    const { cookie } = await superLogin();
    const e = superEnv();
    const tenantId = crypto.randomUUID();
    const stub = e.TENANT_DO.get(e.TENANT_DO.idFromName(tenantId));

    // DO 側は有効化済みだが型が古い(applied_version=0)状態を作る
    // (module-redistribute.test.ts の markStale と同じ様式)。redistribute のファンアウトが
    // 実際に applied_version を進めることを観測できるようにするため。
    await stub.enableModule(tenantId, "booking", auth("owner1"));
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE module_registry SET applied_version = 0 WHERE module_id = 'booking'",
      );
    });

    // control-plane 側の D1 ミラー(tenant_modules)へ enabled=1 の行を direct insert する
    // (afterEach で必ず戻す — 規律)。
    cleanupTenantModule = { tenantId, moduleId: "booking" };
    await drizzle(env.DB)
      .insert(tenantModules)
      .values({ tenantId, moduleId: "booking", enabled: 1, updatedAt: new Date().toISOString() });

    const listed = await app.request("/super/v1/modules", { headers: { cookie } }, e);
    expect(listed.status).toBe(200);
    const { modules } = (await listed.json()) as {
      modules: { moduleId: string; version: number; name: string; enabledTenants: number }[];
    };
    const booking = modules.find((m) => m.moduleId === "booking");
    expect(booking).toMatchObject({ moduleId: "booking", version: 1 });
    expect(booking?.enabledTenants).toBeGreaterThanOrEqual(1);

    const unknown = await app.request(
      jsonReq("POST", "/super/v1/modules/no-such-module/redistribute", cookie),
      undefined,
      e,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "unknown_module" });

    const response = await app.request(
      jsonReq("POST", "/super/v1/modules/booking/redistribute", cookie),
      undefined,
      e,
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });

    // 実 miniflare ブローカ経由で module_redistribute → module_sync が各テナント DO へ届き、
    // applied version が進むまでポーリングする(module-redistribute.test.ts の観測様式)。
    await waitFor(async () => {
      const summaries = asModuleSummaries(await stub.listModules());
      const bookingSummary = summaries.find((m) => m.moduleId === "booking");
      return bookingSummary?.appliedVersion === 1 ? bookingSummary : null;
    });

    expect(await auditActions()).toContain("module.redistribute");
  });
});
