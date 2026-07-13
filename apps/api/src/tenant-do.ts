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
import { loadRecord, writeRecordCore } from "./do/write-record";
import type { RecordSnapshot, WriteRecordInput, WriteRecordResult } from "./do/types";
import { CLOSE_CODES, SYNC_SUBPROTOCOL } from "@plyrs/sync-protocol";
import { AUTH_HEADER, type SocketAuth } from "./sync/session";

export class TenantDO extends DurableObject<Env> {
  private readonly db: DrizzleSqliteDODatabase<typeof schema>;
  // DO 全体の単調 seq（G2）。single-writer なのでメモリ保持 + 起動時復元で十分
  private seq = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema });
    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
      const row = ctx.storage.sql
        .exec<{ max_seq: number | null }>("SELECT MAX(seq) AS max_seq FROM records")
        .one();
      this.seq = row.max_seq ?? 0;
    });
    // ping/pong を DO を起こさずに返す（design-spec §3 のハイバネーション前提）
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
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
    return this.ctx.storage.transactionSync(() =>
      registerContentTypeCore(this.ctx.storage.sql, input, now),
    );
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
    return this.ctx.storage.transactionSync(() =>
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
  }

  getRecord(id: string): RecordSnapshot | null {
    return loadRecord(this.ctx.storage.sql, id);
  }

  deleteRecord(recordId: string, auth: AuthContext): DeleteRecordResult {
    const denial = requireOperation(auth, "record:delete");
    if (denial !== null) {
      return denial;
    }
    return this.ctx.storage.transactionSync(() =>
      deleteRecordCore(
        {
          sql: this.ctx.storage.sql,
          nextSeq: () => ++this.seq,
          now: () => new Date().toISOString(),
        },
        recordId,
        auth.userId,
      ),
    );
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
