import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { app } from "../src/index";
import type { AuthContext } from "../src/do/authorize";
import {
  BOOKING_RESERVATION_KEY,
  BOOKING_RESOURCE_KEY,
  BOOKING_SLOT_KEY,
} from "../src/modules/booking/manifest";
import { BOOKING_PENDING_TTL_MS } from "../src/modules/booking/module";
import type { ModuleQueueJob } from "../src/modules/events";
import { moduleAlarmKind } from "../src/modules/module-alarms";
import { TURNSTILE_VERIFY_URL } from "../src/modules/turnstile";
import { asModuleSummaries, asRecordSnapshot, asWriteResult } from "../src/rpc-unwrap";

// Task 11(module-routes.test.ts)+ publish.test.ts の bootstrapTenant 様式・
// Task 12(public-write.test.ts)の mockSiteverify / fakeLimiter / reservationBody 様式・
// public-helpers.ts の deliverJobs(plyrs-projection)をキュー名だけ plyrs-modules に
// 差し替えた版・booking-module.test.ts の alarm 失効様式を 1 本のシナリオへ組み立てる。
const RUN_ID = crypto.randomUUID().slice(0, 8);
let n = 0;
function unique(prefix: string): string {
  n += 1;
  return `${prefix}${RUN_ID}-${n}`;
}

function uuid(id: number): string {
  return `00000000-0000-7000-8000-${String(id).padStart(12, "0")}`;
}

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

function fakeLimiter(succeed: boolean): {
  limit(options: { key: string }): Promise<{ success: boolean }>;
} {
  return { limit: async () => ({ success: succeed }) };
}

function testEnv(limiterSucceeds = true): Env {
  // §6: AUTH_LIMITER も本物の Miniflare シミュレート ratelimit(--no-isolate で全ファイル共有)。
  // このファイルは auth 系のレート制限自体をテストしないので常に成功させる。
  return {
    ...env,
    PUBLIC_WRITE_LIMITER: fakeLimiter(limiterSucceeds),
    AUTH_LIMITER: fakeLimiter(true),
  };
}

// public-write.test.ts と同じ理由(cloudflare:test の fetchMock 撤去)で globalThis.fetch を spy する。
function mockSiteverify(success: boolean): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "POST" && request.url === TURNSTILE_VERIFY_URL) {
      return new Response(JSON.stringify({ success }), { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${request.method} ${request.url}`);
  });
}

function reservationBody(slotId: string, turnstileToken = "tok"): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turnstileToken,
      input: { slot: slotId, name: "公開予約者", email: "guest@example.com" },
    }),
  };
}

// module-routes.test.ts の setupTenant 様式。公開 write のテナント解決には slug が要るため
// (resolveTenantId は tenants.slug → id)、/v1/tenants に渡した slug をここで併せて返す。
async function setupTenant(): Promise<{
  tenantId: string;
  tenantSlug: string;
  ownerToken: string;
}> {
  const signup = await app.request(
    "/auth/signup",
    json({ email: `${unique("owner")}@example.com`, password: "hunter2hunter2" }),
    testEnv(),
  );
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const tenantSlug = unique("t-");
  const created = await app.request(
    "/v1/tenants",
    json({ name: "T", slug: tenantSlug }, { cookie }),
    testEnv(),
  );
  const { tenantId } = (await created.json()) as { tenantId: string };
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), testEnv());
  const { token: ownerToken } = (await issued.json()) as { token: string };
  return { tenantId, tenantSlug, ownerToken };
}

// public-helpers.ts の deliverJobs と同型: 実ブローカは自動 consume しないため、
// createMessageBatch + worker.queue で plyrs-modules キューへ手動配達する。
async function deliverModuleJobs(jobs: ModuleQueueJob[]): Promise<void> {
  const batch = createMessageBatch<ModuleQueueJob>(
    "plyrs-modules",
    jobs.map((body, i) => ({ id: `mod-${i}`, timestamp: new Date(1_000 + i), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  await getQueueResult(batch, ctx);
}

// module-redistribute.test.ts の「D1 ミラーの有効テナント全件」ファンアウト検証は共有 D1 の
// tenant_modules を厳密一致で見る。このファイルで enable したテナントを disable し忘れると
// 他ファイルの実行順(--no-isolate の共有ストレージ)を汚してしまうため、失敗時も含めて
// 必ず後始末する。
let cleanupTenantId: string | undefined;
let cleanupOwnerToken: string | undefined;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (cleanupTenantId !== undefined && cleanupOwnerToken !== undefined) {
    await app.request(
      `/v1/t/${cleanupTenantId}/modules/booking/disable`,
      { method: "POST", headers: { authorization: `Bearer ${cleanupOwnerToken}` } },
      env,
    );
    cleanupTenantId = undefined;
    cleanupOwnerToken = undefined;
  }
});

describe("モジュールシステム 一気通貫 (Phase 9)", () => {
  it("enable → 公開予約 → 通知 → 満席 → 失効 → 再予約が一巡する", async () => {
    // 1. HTTP で booking を enable(Task 11 の様式)
    const { tenantId, tenantSlug, ownerToken } = await setupTenant();
    cleanupTenantId = tenantId;
    cleanupOwnerToken = ownerToken;
    const authHeader = { authorization: `Bearer ${ownerToken}` };
    const enabled = await app.request(
      `/v1/t/${tenantId}/modules/booking/enable`,
      { method: "POST", headers: authHeader },
      env,
    );
    expect(enabled.status).toBe(200);

    // 2. owner が resource / slot(capacity 1)を HTTP PUT で作成
    const resourceId = uuid(1);
    const slotId = uuid(2);
    const resourcePut = await app.request(
      `/v1/t/${tenantId}/records/booking.resource/${resourceId}`,
      { ...json({ input: { name: "会議室" } }, authHeader), method: "PUT" },
      env,
    );
    expect(resourcePut.status).toBe(200);
    const slotPut = await app.request(
      `/v1/t/${tenantId}/records/booking.slot/${slotId}`,
      {
        ...json(
          {
            input: {
              resource: { type: "booking.resource", id: resourceId },
              starts_at: "2026-08-01T10:00:00Z",
              ends_at: "2026-08-01T11:00:00Z",
              capacity: 1,
            },
          },
          authHeader,
        ),
        method: "PUT",
      },
      env,
    );
    expect(slotPut.status).toBe(200);

    // 3. 公開 write(Turnstile モック + fakeLimiter)→ 201。予約 recordId を得る
    mockSiteverify(true);
    const first = await app.request(
      `/public/v1/${tenantSlug}/modules/booking/reservations`,
      reservationBody(slotId),
      testEnv(),
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { ok: true; recordId: string };
    expect(firstBody.ok).toBe(true);
    const reservationId = firstBody.recordId;

    // 4. module_event ジョブを手動配達 → booking.notification が 1 件
    // (実運用では drainModuleEvents/sweep が送出する。テストブローカは自動 consume しないため、
    //  公開 write の結果から job を組み立てて配達する — public-helpers の既知の制約と同じ)
    await deliverModuleJobs([
      {
        kind: "module_event",
        eventId: uuid(900),
        tenantId,
        moduleId: "booking",
        event: "afterWrite",
        recordId: reservationId,
        typeKey: BOOKING_RESERVATION_KEY,
      },
    ]);
    const tenant = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await runInDurableObject(tenant, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM records WHERE type = 'booking.notification' AND deleted_at IS NULL",
        )
        .one();
      expect(rows.n).toBe(1);
    });

    // 5. 公開 write 2 件目 → 409 booking:slot_full
    mockSiteverify(true);
    const second = await app.request(
      `/public/v1/${tenantSlug}/modules/booking/reservations`,
      reservationBody(slotId),
      testEnv(),
    );
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code: string }).code).toBe("booking:slot_full");

    // 6. runInDurableObject で updated_at / due_at を過去へ倒し runDurableObjectAlarm → cancelled
    // (booking-module.test.ts の様式: 物理 setAlarm は未来にしておく。workerd は過去日時の
    //  setAlarm を即時に自動発火させ、runDurableObjectAlarm を呼ぶ前に消費してしまうため)
    await runInDurableObject(tenant, async (_instance, state) => {
      const past = new Date(Date.now() - BOOKING_PENDING_TTL_MS - 60_000).toISOString();
      state.storage.sql.exec("UPDATE records SET updated_at = ? WHERE id = ?", past, reservationId);
      state.storage.sql.exec(
        "UPDATE alarm_registry SET due_at = ? WHERE kind = ?",
        Date.now() - 1_000,
        moduleAlarmKind("booking"),
      );
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    const ran = await runDurableObjectAlarm(tenant);
    expect(ran).toBe(true);
    const cancelled = asRecordSnapshot(await tenant.getRecord(reservationId));
    expect(cancelled?.data["state"]).toBe("cancelled");

    // 7. 公開 write 3 件目 → 201(枠が解放されている)
    mockSiteverify(true);
    const third = await app.request(
      `/public/v1/${tenantSlug}/modules/booking/reservations`,
      reservationBody(slotId),
      testEnv(),
    );
    expect(third.status).toBe(201);
  });
});

describe("§15 冒頭掃除(実害系 3 件)", () => {
  it("module_registry の壊れた permissions 行があっても listModules は throw しない", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const owner: AuthContext = { userId: "u-owner", role: "owner", tenantId };
    await stub.enableModule(tenantId, "booking", owner);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE module_registry SET permissions = 'not-json' WHERE module_id = 'booking'",
      );
    });
    // 壊れた行があっても一覧 RPC は throw しない(permissions は MODULE_REGISTRY から再導出される)
    const modules = asModuleSummaries(await stub.listModules());
    expect(Array.isArray(modules)).toBe(true);
    expect(modules.find((m) => m.moduleId === "booking")?.enabled).toBe(true);
  });

  it("壊れた permissions 行は MODULE_REGISTRY から再導出され、editor の owner 限定型書き込みは forbidden のまま", async () => {
    // ユーザー裁定(2026-07-18): 壊れた permissions 行のフォールバックは fail-open(空 grants)ではなく、
    // コード内静的マニフェスト(MODULE_REGISTRY)を真実源として再導出する。ガードの実効性が
    // 保たれていることを、editor が owner 限定型(booking.reservation)へ書けないことで固定する。
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const owner: AuthContext = { userId: "u-owner", role: "owner", tenantId };
    const editor: AuthContext = { userId: "u-editor", role: "editor", tenantId };
    await stub.enableModule(tenantId, "booking", owner);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE module_registry SET permissions = 'not-json' WHERE module_id = 'booking'",
      );
    });
    const result = asWriteResult(
      await stub.writeRecord(
        BOOKING_RESERVATION_KEY,
        {
          recordId: crypto.randomUUID(),
          input: {
            slot: { type: BOOKING_SLOT_KEY, id: crypto.randomUUID() },
            name: "x",
            email: "x@example.com",
            state: "pending",
          },
        },
        editor,
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("forbidden");
  });

  it("管理 API 経由の booking:slot_full(モジュール拒否コード)は 409 を返す", async () => {
    const { tenantId, ownerToken } = await setupTenant();
    cleanupTenantId = tenantId;
    cleanupOwnerToken = ownerToken;
    const authHeader = { authorization: `Bearer ${ownerToken}` };
    const enabled = await app.request(
      `/v1/t/${tenantId}/modules/booking/enable`,
      { method: "POST", headers: authHeader },
      env,
    );
    expect(enabled.status).toBe(200);

    const resourceId = uuid(11);
    const slotId = uuid(12);
    await app.request(
      `/v1/t/${tenantId}/records/${BOOKING_RESOURCE_KEY}/${resourceId}`,
      { ...json({ input: { name: "会議室" } }, authHeader), method: "PUT" },
      env,
    );
    await app.request(
      `/v1/t/${tenantId}/records/${BOOKING_SLOT_KEY}/${slotId}`,
      {
        ...json(
          {
            input: {
              resource: { type: BOOKING_RESOURCE_KEY, id: resourceId },
              starts_at: "2026-08-01T10:00:00Z",
              ends_at: "2026-08-01T11:00:00Z",
              capacity: 1,
            },
          },
          authHeader,
        ),
        method: "PUT",
      },
      env,
    );

    const reservationPut = (): RequestInit => ({
      ...json(
        {
          input: {
            slot: { type: BOOKING_SLOT_KEY, id: slotId },
            name: "予約者",
            email: "r@example.com",
            state: "pending",
          },
        },
        authHeader,
      ),
      method: "PUT",
    });
    const first = await app.request(
      `/v1/t/${tenantId}/records/${BOOKING_RESERVATION_KEY}/${uuid(13)}`,
      reservationPut(),
      env,
    );
    expect(first.status).toBe(200);

    const second = await app.request(
      `/v1/t/${tenantId}/records/${BOOKING_RESERVATION_KEY}/${uuid(14)}`,
      reservationPut(),
      env,
    );
    // 期待: モジュール拒否(`booking:slot_full` 等の ':' 含みコード)は管理 API でも 409
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code: string }).code).toBe("booking:slot_full");
  });
});
