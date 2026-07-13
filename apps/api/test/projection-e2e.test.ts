import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asPublishResult, asWriteResult } from "./rpc-unwrap";

// Queue の配送は非同期（miniflare のブローカ経由）。フラッシュ API は無いのでポーリングする。
async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for the projection");
    }
    await scheduler.wait(25);
  }
}

// このファイルは他のテストと同じ miniflare インスタンス（--no-isolate --max-workers=1）を共有し、
// キューブローカは非同期なので他ファイルの配送中メッセージが実行中に紛れ込みうる。
// そのため record id は 1300 番台という未使用レンジを使い、tenant_id は毎回 crypto.randomUUID()
// で新規発行し、集計はテーブル全体件数ではなく必ず tenant_id + record_id で絞って読む。
describe("publish → outbox → queue → projection D1 (wiring)", () => {
  it("projects a published record without any test-side queue plumbing", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const recordId = uuid(1300);

    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);

    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    expect(published.ok).toBe(true);

    const row = await waitFor(() =>
      env.PROJECTION_DB.prepare(
        "SELECT slug, source_version FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ slug: string; source_version: number }>(),
    );
    expect(row).toMatchObject({ slug: "hello", source_version: 1 });
  });

  it("removes the projection when the record is unpublished", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const recordId = uuid(1301);

    await stub.registerContentType(articleType(), auth("owner1"));
    await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1"));
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    await waitFor(() =>
      env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>(),
    );

    await stub.unpublishRecord(tenantId, recordId, auth("owner1"));
    const gone = await waitFor(async () => {
      const row = await env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>();
      return row === null ? "gone" : null;
    });
    expect(gone).toBe("gone");
  });

  it("cascades the unpublish into the projection when the record is deleted", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const recordId = uuid(1302);

    await stub.registerContentType(articleType(), auth("owner1"));
    await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1"));
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    await waitFor(() =>
      env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>(),
    );

    await stub.deleteRecord(recordId, auth("owner1"));
    const gone = await waitFor(async () => {
      const row = await env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>();
      return row === null ? "gone" : null;
    });
    expect(gone).toBe("gone");
  });
});
