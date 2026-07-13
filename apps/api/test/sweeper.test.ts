import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asPublishResult, asWriteResult } from "./rpc-unwrap";

describe("outbox sweeper on the alarm registry (design-spec §9.6 / §12.3)", () => {
  let tenantId: string;
  let stub: DurableObjectStub<import("../src/tenant-do").TenantDO>;
  const recordId = uuid(300);

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);
  });

  it("drains the outbox on the publish path and leaves nothing pending", async () => {
    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    expect(published.ok).toBe(true);
    expect(await stub.pendingOutbox()).toBe(0);
  });

  it("arms an alarm in the same transaction as the outbox row", async () => {
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    await runInDurableObject(stub, async (_instance, state) => {
      // 正常系で排出済みでも、レジストリの掃除は sweeper の仕事なのでアラームは張られたまま
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it("sweeps unsent rows and clears its registration when the outbox is empty", async () => {
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.pendingOutbox()).toBe(0);

    await runInDurableObject(stub, async (_instance, state) => {
      // 未送出が無くなったので登録は消え、次のアラームも張られない
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("re-arms the alarm from the registry when the DO restarts", async () => {
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    await runInDurableObject(stub, async (_instance, state) => {
      // アラームを失った状態（sweeper のバグ・リトライ枯渇等）を再現
      await state.storage.deleteAlarm();
      expect(await state.storage.getAlarm()).toBeNull();
    });

    await evictDurableObject(stub);
    await stub.ping(); // constructor を走らせる

    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });
});
