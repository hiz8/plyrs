import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import type { AuthContext } from "../src/do/authorize";
import { TURNSTILE_VERIFY_URL } from "../src/modules/turnstile";
import { asRecordSnapshot } from "../src/rpc-unwrap";

// design-spec §11.7(論点W)のブリーフは Turnstile の siteverify を `fetchMock`(cloudflare:test)で
// モックする想定だったが、このワークスペースの @cloudflare/vitest-pool-workers は
// `import { fetchMock } from "cloudflare:test"` を既に撤去済み(公式 CHANGELOG: 「This has been
// removed. Instead, mock globalThis.fetch ...」)。ここでは公式が示す代替
// (vi.spyOn(globalThis, "fetch"))で siteverify だけを差し替える。テストの意図(Turnstile
// 成功/失敗・呼ばれる/呼ばれない)は変えていない。

// gate.test.ts の unique 様式: 共有ストレージ(--no-isolate)では DO 名(= tenantId)が
// 衝突すると capacity 1 の枠を it 間で食い合う。テナントごとに DO を分けるため it ごとに
// TENANT_ID/SLUG を分ける。
const RUN_ID = crypto.randomUUID().slice(0, 8);
let n = 0;
function unique(prefix: string): string {
  n += 1;
  return `${prefix}-${RUN_ID}-${n}`;
}

function uuid(id: number): string {
  return `00000000-0000-7000-8000-${String(id).padStart(12, "0")}`;
}

function fakeLimiter(succeed: boolean): {
  limit(options: { key: string }): Promise<{ success: boolean }>;
} {
  return { limit: async () => ({ success: succeed }) };
}

function testEnv(limiterSucceeds = true): Env {
  return { ...env, PUBLIC_WRITE_LIMITER: fakeLimiter(limiterSucceeds) };
}

// siteverify だけに応答する fetch モック。他の URL への到達は(この経路では起こらないはずなので)
// 即座にテストを失敗させる。
function mockSiteverify(success: boolean): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "POST" && request.url === TURNSTILE_VERIFY_URL) {
      return new Response(JSON.stringify({ success }), { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${request.method} ${request.url}`);
  });
}

// Turnstile まで到達してはいけない経路(レート制限・入力検証エラー)用。呼ばれたらテストを失敗させる。
function forbidFetch(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    throw new Error(`turnstile should not be reached: ${request.method} ${request.url}`);
  });
}

function reservationBody(turnstileToken = "tok"): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turnstileToken,
      input: { slot: uuid(2), name: "公開予約者", email: "guest@example.com" },
    }),
  };
}

async function seedTenantAndSlot(tenantId: string, tenantSlug: string): Promise<void> {
  const owner: AuthContext = { userId: "u-owner", role: "owner", tenantId };
  await env.DB.prepare(
    "INSERT OR REPLACE INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(tenantId, tenantSlug, "公開予約テナント", new Date().toISOString())
    .run();
  const tenant = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  await tenant.enableModule(tenantId, "booking", owner);
  await tenant.writeRecord(
    "booking.resource",
    { recordId: uuid(1), input: { name: "会議室" } },
    owner,
  );
  await tenant.writeRecord(
    "booking.slot",
    {
      recordId: uuid(2),
      input: {
        resource: { type: "booking.resource", id: uuid(1) },
        starts_at: "2026-08-01T10:00:00Z",
        ends_at: "2026-08-01T11:00:00Z",
        capacity: 1,
      },
    },
    owner,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("公開 write (design-spec §11.7 = 論点W)", () => {
  it("Turnstile を通過した予約が 201 で作成される", async () => {
    const tenantId = unique("t-pubwrite");
    const tenantSlug = unique("pubwrite");
    await seedTenantAndSlot(tenantId, tenantSlug);
    mockSiteverify(true);
    const res = await app.request(
      `/public/v1/${tenantSlug}/modules/booking/reservations`,
      reservationBody(),
      testEnv(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: true; recordId: string };
    expect(body.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalled();
    // DO に pending 予約が作られている(actor は public:booking)
    const tenant = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const record = asRecordSnapshot(await tenant.getRecord(body.recordId));
    expect(record?.data["state"]).toBe("pending");
    expect(record?.createdBy).toBe("public:booking");
  });

  it("Turnstile 失敗は 403、siteverify にはリクエストが飛ぶ", async () => {
    const tenantId = unique("t-pubwrite");
    const tenantSlug = unique("pubwrite");
    await seedTenantAndSlot(tenantId, tenantSlug);
    mockSiteverify(false);
    const res = await app.request(
      `/public/v1/${tenantSlug}/modules/booking/reservations`,
      reservationBody(),
      testEnv(),
    );
    expect(res.status).toBe(403);
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("レート制限超過は 429(Turnstile まで到達しない)", async () => {
    const tenantId = unique("t-pubwrite");
    const tenantSlug = unique("pubwrite");
    await seedTenantAndSlot(tenantId, tenantSlug);
    forbidFetch();
    const res = await app.request(
      `/public/v1/${tenantSlug}/modules/booking/reservations`,
      reservationBody(),
      testEnv(false),
    );
    expect(res.status).toBe(429);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("満席の枠は booking:slot_full の 409(第2段のフックが公開経路にも効く)", async () => {
    const tenantId = unique("t-pubwrite");
    const tenantSlug = unique("pubwrite");
    await seedTenantAndSlot(tenantId, tenantSlug);
    mockSiteverify(true);
    const first = await app.request(
      `/public/v1/${tenantSlug}/modules/booking/reservations`,
      reservationBody(),
      testEnv(),
    );
    expect(first.status).toBe(201);
    mockSiteverify(true);
    const second = await app.request(
      `/public/v1/${tenantSlug}/modules/booking/reservations`,
      reservationBody(),
      testEnv(),
    );
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code: string }).code).toBe("booking:slot_full");
  });

  it("入力検証エラーは Turnstile 前に 400(siteverify を浪費しない)", async () => {
    const tenantId = unique("t-pubwrite");
    const tenantSlug = unique("pubwrite");
    await seedTenantAndSlot(tenantId, tenantSlug);
    forbidFetch();
    const res = await app.request(
      `/public/v1/${tenantSlug}/modules/booking/reservations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turnstileToken: "tok", input: { slot: "not-a-uuid" } }),
      },
      testEnv(),
    );
    expect(res.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("未知エンドポイント・未有効モジュール・未構成は閉じる", async () => {
    const tenantId = unique("t-pubwrite");
    const tenantSlug = unique("pubwrite");
    await seedTenantAndSlot(tenantId, tenantSlug);
    forbidFetch();
    const unknown = await app.request(
      `/public/v1/${tenantSlug}/modules/booking/ghost`,
      reservationBody(),
      testEnv(),
    );
    expect(unknown.status).toBe(404);
    // 濫用防止層の未構成は fail-closed(503)
    const bare = { ...env, PUBLIC_WRITE_LIMITER: undefined } as unknown as Env;
    const misconfigured = await app.request(
      `/public/v1/${tenantSlug}/modules/booking/reservations`,
      reservationBody(),
      bare,
    );
    expect(misconfigured.status).toBe(503);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
