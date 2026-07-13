import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import * as schema from "@plyrs/db";
import migrations from "@plyrs/db/migrations";
import { contentTypeDefinitionSchema } from "@plyrs/metamodel";
import { v7 as uuidv7 } from "uuid";
import { requireOperation, type AuthContext } from "./do/authorize";
import {
  loadContentTypeByKey,
  registerContentTypeCore,
  type ContentTypeRow,
  type RegisterContentTypeResult,
} from "./do/content-types";
import { deleteRecordCore, type DeleteRecordResult } from "./do/delete-record";
import {
  loadProjectionPayload,
  loadPublishedPage,
  publishRecordCore,
  unpublishRecordCore,
  type PublishResult,
  type UnpublishResult,
} from "./do/publish";
import { loadRecord, writeRecordCore } from "./do/write-record";
import type { RecordSnapshot, WriteRecordInput, WriteRecordResult } from "./do/types";
import type { ProjectionPayload } from "./projection/payload";
import {
  CLOSE_CODES,
  KEEPALIVE_PING,
  KEEPALIVE_PONG,
  parseClientMessage,
  SYNC_SUBPROTOCOL,
  type ServerMessage,
} from "@plyrs/sync-protocol";
import { handleHello, handlePush, type PushOutcome } from "./sync/handlers";
import { AUTH_HEADER, isTokenExpired, readSocketAuth, type SocketAuth } from "./sync/session";
import { loadAllContentTypes, loadSyncRecord } from "./sync/records";

export class TenantDO extends DurableObject<Env> {
  private readonly db: DrizzleSqliteDODatabase<typeof schema>;
  // DO 全体の単調 seq（G2）。single-writer なのでメモリ保持 + 起動時復元で十分
  private seq = 0;
  // CRITICAL fix（レビュー指摘）: 投影ジョブの順序トークン専用の単調カウンタ。records.version は
  // publish/unpublish で変化しないため順序トークンになれない（unpublish→無編集republish が同じ
  // version の upsert/delete を生み、Queues の配信順序非保証と組み合わさると事故る）。
  // publish・unpublish（cascade 含む）は必ずこれで新しい世代番号を採る。
  private publishSeq = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema });
    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
      const row = ctx.storage.sql
        .exec<{ max_seq: number | null }>("SELECT MAX(seq) AS max_seq FROM records")
        .one();
      this.seq = row.max_seq ?? 0;
      // published_snapshots と outbox の双方の MAX を取る: unpublish は snapshot 行を消すが
      // その delete の outbox 行は残る（sent=1 でも purge されるまでは残る）ため、snapshot 側
      // だけを見ると番号を巻き戻して再発行し、このバグを再び開けてしまう。
      const snapshotMax = ctx.storage.sql
        .exec<{ max_seq: number | null }>(
          "SELECT MAX(publish_seq) AS max_seq FROM published_snapshots",
        )
        .one().max_seq;
      const outboxMax = ctx.storage.sql
        .exec<{ max_seq: number | null }>("SELECT MAX(publish_seq) AS max_seq FROM outbox")
        .one().max_seq;
      this.publishSeq = Math.max(snapshotMax ?? 0, outboxMax ?? 0);
    });
    // ping/pong を DO を起こさずに返す（design-spec §3 のハイバネーション前提）
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEPALIVE_PING, KEEPALIVE_PONG));
  }

  ping(): string {
    return "pong";
  }

  // モノレポの .ts 直接 exports が workerd バンドルを通ることの早期検証を兼ねる
  validateContentTypeInput(input: unknown): { valid: boolean } {
    return { valid: contentTypeDefinitionSchema.safeParse(input).success };
  }

  registerContentType(input: unknown, auth: AuthContext): RegisterContentTypeResult {
    const denial = requireOperation(auth, "type:manage");
    if (denial !== null) {
      return denial;
    }
    const now = new Date().toISOString();
    const result = this.ctx.storage.transactionSync(() =>
      registerContentTypeCore(this.ctx.storage.sql, input, now),
    );
    if (result.ok) {
      // G1: content_types は seq を消費しない別チャネル。変更をコミット後に全接続へ配る。
      this.broadcastAll({
        type: "content-types",
        contentTypes: loadAllContentTypes(this.ctx.storage.sql),
      });
    }
    return result;
  }

  getContentType(key: string): ContentTypeRow | null {
    return loadContentTypeByKey(this.ctx.storage.sql, key);
  }

  writeRecord(typeKey: string, params: WriteRecordInput, auth: AuthContext): WriteRecordResult {
    const denial = requireOperation(auth, "record:write");
    if (denial !== null) {
      return denial;
    }
    const contentType = loadContentTypeByKey(this.ctx.storage.sql, typeKey);
    if (contentType === null) {
      return { ok: false, code: "unknown_type", message: `unknown content type: ${typeKey}` };
    }
    const result = this.ctx.storage.transactionSync(() =>
      writeRecordCore(
        {
          sql: this.ctx.storage.sql,
          nextSeq: () => ++this.seq,
          now: () => new Date().toISOString(),
          newRelationId: () => uuidv7(),
        },
        contentType,
        { ...params, actor: auth.userId },
      ),
    );
    if (result.ok && result.applied) {
      const stored = loadSyncRecord(this.ctx.storage.sql, params.recordId);
      if (stored !== null) {
        this.broadcastAll({ type: "change", record: stored });
      }
    }
    return result;
  }

  getRecord(id: string): RecordSnapshot | null {
    return loadRecord(this.ctx.storage.sql, id);
  }

  deleteRecord(recordId: string, auth: AuthContext): DeleteRecordResult {
    const denial = requireOperation(auth, "record:delete");
    if (denial !== null) {
      return denial;
    }
    const result = this.ctx.storage.transactionSync(() =>
      deleteRecordCore(
        {
          sql: this.ctx.storage.sql,
          nextSeq: () => ++this.seq,
          now: () => new Date().toISOString(),
          newId: () => uuidv7(),
          nextPublishSeq: () => ++this.publishSeq,
        },
        recordId,
        auth.userId,
      ),
    );
    if (result.ok) {
      const tombstone = loadSyncRecord(this.ctx.storage.sql, recordId);
      if (tombstone !== null) {
        this.broadcastAll({ type: "change", record: tombstone });
      }
    }
    return result;
  }

  // DO は自分が idFromName のどの名前で起きたかを知らない。投影ジョブの宛先に必要なので永続化する。
  private rememberTenant(tenantId: string): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO do_config (key, value) VALUES ('tenant_id', ?)",
      tenantId,
    );
  }

  publishRecord(tenantId: string, recordId: string, auth: AuthContext): PublishResult {
    const denial = requireOperation(auth, "record:publish");
    if (denial !== null) {
      return denial;
    }
    return this.ctx.storage.transactionSync(() => {
      this.rememberTenant(tenantId);
      return publishRecordCore(
        {
          sql: this.ctx.storage.sql,
          now: () => new Date().toISOString(),
          newId: () => uuidv7(),
          nextPublishSeq: () => ++this.publishSeq,
        },
        recordId,
        auth.userId,
      );
    });
  }

  unpublishRecord(tenantId: string, recordId: string, auth: AuthContext): UnpublishResult {
    const denial = requireOperation(auth, "record:publish");
    if (denial !== null) {
      return denial;
    }
    return this.ctx.storage.transactionSync(() => {
      this.rememberTenant(tenantId);
      return unpublishRecordCore(
        {
          sql: this.ctx.storage.sql,
          now: () => new Date().toISOString(),
          newId: () => uuidv7(),
          nextPublishSeq: () => ++this.publishSeq,
        },
        recordId,
      );
    });
  }

  // Queues consumer が投影ペイロードを取りに来る経路（メッセージ本体にデータを載せない）
  getProjectionPayload(recordId: string): ProjectionPayload | null {
    return loadProjectionPayload(this.ctx.storage.sql, recordId);
  }

  getPublishedPage(
    cursor: string | null,
    limit: number,
  ): { payloads: ProjectionPayload[]; nextCursor: string | null } {
    return loadPublishedPage(this.ctx.storage.sql, cursor, limit);
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }
    const rawAuth = request.headers.get(AUTH_HEADER);
    if (rawAuth === null) {
      return new Response("unauthenticated", { status: 401 });
    }
    let auth: SocketAuth;
    try {
      auth = JSON.parse(rawAuth) as SocketAuth;
    } catch {
      return new Response("bad auth header", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernation API: server.accept() は呼ばない（呼ぶとハイバネーションが無効化される）
    this.ctx.acceptWebSocket(server, [`user:${auth.userId}`]);
    server.serializeAttachment(auth);

    return new Response(null, {
      status: 101,
      webSocket: client,
      // 提示された値のいずれかを必ずエコーする（さもないとブラウザが接続を失敗させる）
      headers: { "sec-websocket-protocol": SYNC_SUBPROTOCOL },
    });
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    ws.send(JSON.stringify(message));
  }

  // 失効したソケットへは配信しない（読み取り側にも ≤15分の失効を効かせる）。
  // DO が既に起きている時にしか走らないためハイバネーションコストは変わらない。
  private isSocketLive(socket: WebSocket, nowMs: number): boolean {
    if (socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    const auth = readSocketAuth(socket);
    if (auth === null || isTokenExpired(auth, nowMs)) {
      socket.close(CLOSE_CODES.tokenExpired, "token_expired");
      return false;
    }
    return true;
  }

  private broadcast(exclude: WebSocket, message: ServerMessage): void {
    const payload = JSON.stringify(message);
    const nowMs = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exclude) {
        continue;
      }
      if (!this.isSocketLive(socket, nowMs)) {
        continue;
      }
      socket.send(payload);
    }
  }

  private broadcastAll(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    const nowMs = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      if (!this.isSocketLive(socket, nowMs)) {
        continue;
      }
      socket.send(payload);
    }
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await Promise.resolve();
    const auth = readSocketAuth(ws);
    if (auth === null) {
      ws.close(CLOSE_CODES.protocolError, "no_session");
      return;
    }
    // Phase 3 申し送り: 15分 JWT はソケット確立後に切れる。メッセージ処理の入口で検査する。
    if (isTokenExpired(auth, Date.now())) {
      ws.close(CLOSE_CODES.tokenExpired, "token_expired");
      return;
    }
    if (typeof message !== "string") {
      ws.close(CLOSE_CODES.protocolError, "binary_unsupported");
      return;
    }
    const parsed = parseClientMessage(message);
    if (parsed === null) {
      ws.close(CLOSE_CODES.protocolError, "malformed_message");
      return;
    }
    if (parsed.type === "hello") {
      for (const outgoing of handleHello(this.ctx.storage.sql, parsed.checkpoint)) {
        this.send(ws, outgoing);
      }
    }
    if (parsed.type === "push") {
      let outcome: PushOutcome;
      try {
        // 変異はトランザクション内。ブロードキャストはコミット後（未コミットの seq を見せない）。
        outcome = this.ctx.storage.transactionSync(() =>
          handlePush(
            {
              sql: this.ctx.storage.sql,
              nextSeq: () => ++this.seq,
              now: () => new Date().toISOString(),
              newRelationId: () => uuidv7(),
              nextPublishSeq: () => ++this.publishSeq,
            },
            parsed.changes,
            { userId: auth.userId, role: auth.role },
          ),
        );
      } catch (error) {
        // トランザクションはロールバック済み。ack 無しでクライアントを宙吊りにしない。
        // 内部エラーの詳細はクライアントに返さない（ログにのみ残す）。
        console.error("push failed", error);
        for (const change of parsed.changes) {
          this.send(ws, {
            type: "ack",
            changeId: change.changeId,
            result: { ok: false, code: "internal_error", message: "push failed" },
          });
        }
        return;
      }
      for (const ackMessage of outcome.acks) {
        this.send(ws, ackMessage);
      }
      for (const broadcastMessage of outcome.broadcasts) {
        this.broadcast(ws, broadcastMessage);
      }
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    // compat date 2026-07-12 では close ハンドシェイクは runtime が完了済み。ここは掃除のみ。
    await Promise.resolve();
    ws.close();
  }

  // テスト用（tag によるソケット計数）。Phase 10 の運用画面でも使える。
  countSockets(tag: string): number {
    return this.ctx.getWebSockets(tag).length;
  }

  // Phase 3 申し送り: 確立済みソケットは BAN 後も生き続けるため、明示的に切る経路を持つ。
  disconnectUser(userId: string): number {
    const sockets = this.ctx.getWebSockets(`user:${userId}`);
    for (const socket of sockets) {
      socket.close(CLOSE_CODES.blocked, "blocked");
    }
    return sockets.length;
  }
}
