import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ClientChange, ServerMessage } from "@plyrs/sync-protocol";
import type { SocketAuth } from "../src/sync/session";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asPublishResult, asWriteResult } from "./rpc-unwrap";
import { nextMessage, openSyncSocket } from "./ws-helpers";

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

  // CRITICAL fix（レビュー指摘）: 同期ソケットの push 経路で届く delete は deleteRecordCore →
  // cascadeUnpublish で outbox に delete 行を積むが、HTTP RPC の deleteRecord/publishRecord/
  // unpublishRecord と違ってこの経路だけ sweep を張らず outbox を排出していなかった。
  // レジストリが空のままだと constructor の再アーム保険も効かず、以後このテナントで
  // publish/unpublish/HTTP delete が一度も呼ばれなければ outbox 行は永久に排出されない
  // ―― 公開停止されたはずのレコードが投影に残り続ける。ここでは他のテストと同じ実 miniflare
  // キューブローカ（worker.queue() を呼ばない）経由で、WebSocket push の delete が実際に
  // 投影行を消すところまでポーリングで確認する。
  it("cascades the unpublish into the projection when the record is deleted over the sync push path", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const recordId = uuid(1400);

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

    const socketAuth: SocketAuth = {
      userId: "editor-1",
      role: "editor",
      tenantId,
      exp: Math.floor(Date.now() / 1000) + 900,
    };
    const { socket } = await openSyncSocket(stub, socketAuth);
    const removal: ClientChange = {
      changeId: crypto.randomUUID(),
      recordId,
      typeKey: "article",
      op: "delete",
      input: {},
      changedFields: [],
      baseFieldVersions: {},
    };
    socket.send(JSON.stringify({ type: "push", changes: [removal] }));
    const ack: ServerMessage = await nextMessage(socket);
    expect(ack.type).toBe("ack");
    if (ack.type === "ack") {
      expect(ack.result.ok).toBe(true);
    }
    socket.close(1000, "done");

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
