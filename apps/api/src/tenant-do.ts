import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import * as schema from "@plyrs/db";
import migrations from "@plyrs/db/migrations";
import { contentTypeDefinitionSchema } from "@plyrs/metamodel";
import { v7 as uuidv7 } from "uuid";
import {
  clearAlarm,
  dueKinds,
  effectiveNow,
  minDueAt,
  OUTBOX_SWEEP,
  registerAlarm,
  SWEEP_DELAY_MS,
  SWEEP_RETRY_MS,
} from "./do/alarms";
import { requireOperation, type AuthContext } from "./do/authorize";
import {
  loadContentTypeByKey,
  registerContentTypeCore,
  type ContentTypeRow,
  type RegisterContentTypeResult,
} from "./do/content-types";
import { deleteRecordCore, type DeleteRecordResult } from "./do/delete-record";
import { countUnsent, markOutboxSent, purgeSent, unsentOutbox } from "./do/outbox";
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
import type { ProjectionJob } from "./projection/jobs";
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
      // CRITICAL fix（レビュー指摘）: do_config.publish_seq が復元の一次情報。published_snapshots
      // は unpublish で行が消え、outbox も purgeSent()（sent=1 の掃除。Task 6 のスイーパーが定期的に
      // 呼ぶ）で行が消えるため、どちらのテーブルも「これまで発行した最大値」を恒久的には保持しない
      // ―― publish→unpublish→purge→evict→republish で番号が巻き戻り、旧世代の delete ジョブが
      // republish 後の投影行を消す事故を再び開けてしまう。do_config は publish/unpublish と同じ
      // トランザクションで書くため、テーブル側の行が消えても残る。以下の MAX スキャンは do_config の
      // 行が無かった古い DO のための床（belt and braces）に過ぎない。
      const storedRaw = ctx.storage.sql
        .exec<{ value: string }>("SELECT value FROM do_config WHERE key = 'publish_seq'")
        .toArray()[0]?.value;
      const storedSeq = storedRaw === undefined ? 0 : Number(storedRaw);
      const snapshotMax = ctx.storage.sql
        .exec<{ max_seq: number | null }>(
          "SELECT MAX(publish_seq) AS max_seq FROM published_snapshots",
        )
        .one().max_seq;
      const outboxMax = ctx.storage.sql
        .exec<{ max_seq: number | null }>("SELECT MAX(publish_seq) AS max_seq FROM outbox")
        .one().max_seq;
      this.publishSeq = Math.max(storedSeq, snapshotMax ?? 0, outboxMax ?? 0, 0);
      // 保険: アラームを失っても（sweeper のバグ・リトライ枯渇）、次に DO が起きた時に張り直す。
      // outbox 行とアラームは同一トランザクションで書くため通常は失われない。
      const due = minDueAt(ctx.storage.sql);
      if (due !== null && (await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(due);
      }
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

  async deleteRecord(recordId: string, auth: AuthContext): Promise<DeleteRecordResult> {
    const denial = requireOperation(auth, "record:delete");
    if (denial !== null) {
      return denial;
    }
    // setAlarm は transactionSync に参加し、ロールバックで巻き戻る（実証済み）。
    // クロージャ内では await できないので promise を掴み、トランザクションを出てから待つ。
    let armed: Promise<void> | null = null;
    const result = this.ctx.storage.transactionSync(() => {
      const inner = deleteRecordCore(
        {
          sql: this.ctx.storage.sql,
          nextSeq: () => ++this.seq,
          now: () => new Date().toISOString(),
          newId: () => uuidv7(),
          nextPublishSeq: () => this.nextPublishSeq(),
        },
        recordId,
        auth.userId,
      );
      if (inner.ok) {
        armed = this.armSweep(Date.now() + SWEEP_DELAY_MS);
      }
      return inner;
    });
    if (armed !== null) {
      await armed;
    }
    if (result.ok) {
      const tombstone = loadSyncRecord(this.ctx.storage.sql, recordId);
      if (tombstone !== null) {
        this.broadcastAll({ type: "change", record: tombstone });
      }
      await this.drainOutbox();
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

  // CRITICAL fix（レビュー指摘）: 発番のたびに do_config へ永続化する。呼び出し元は必ず
  // transactionSync の中からこれを呼ぶ（publish/unpublish/delete の各パス） —— 永続化はメモリ更新と
  // 同じトランザクションでコミット/ロールバックされる。ロールバックでメモリ側のカウンタだけが先に
  // 進んだ状態になるのは許容する（欠番は許すが、再利用は許さない、という設計どおり）。
  private nextPublishSeq(): number {
    this.publishSeq += 1;
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO do_config (key, value) VALUES ('publish_seq', ?)",
      String(this.publishSeq),
    );
    return this.publishSeq;
  }

  async publishRecord(
    tenantId: string,
    recordId: string,
    auth: AuthContext,
  ): Promise<PublishResult> {
    const denial = requireOperation(auth, "record:publish");
    if (denial !== null) {
      return denial;
    }
    // setAlarm は transactionSync に参加し、ロールバックで巻き戻る（実証済み）。
    // クロージャ内では await できないので promise を掴み、トランザクションを出てから待つ。
    let armed: Promise<void> | null = null;
    const result = this.ctx.storage.transactionSync(() => {
      this.rememberTenant(tenantId);
      const inner = publishRecordCore(
        {
          sql: this.ctx.storage.sql,
          now: () => new Date().toISOString(),
          newId: () => uuidv7(),
          nextPublishSeq: () => this.nextPublishSeq(),
        },
        recordId,
        auth.userId,
      );
      if (inner.ok) {
        armed = this.armSweep(Date.now() + SWEEP_DELAY_MS);
      }
      return inner;
    });
    if (armed !== null) {
      await armed;
    }
    if (result.ok) {
      await this.drainOutbox();
    }
    return result;
  }

  async unpublishRecord(
    tenantId: string,
    recordId: string,
    auth: AuthContext,
  ): Promise<UnpublishResult> {
    const denial = requireOperation(auth, "record:publish");
    if (denial !== null) {
      return denial;
    }
    let armed: Promise<void> | null = null;
    const result = this.ctx.storage.transactionSync(() => {
      this.rememberTenant(tenantId);
      const inner = unpublishRecordCore(
        {
          sql: this.ctx.storage.sql,
          now: () => new Date().toISOString(),
          newId: () => uuidv7(),
          nextPublishSeq: () => this.nextPublishSeq(),
        },
        recordId,
      );
      if (inner.ok) {
        armed = this.armSweep(Date.now() + SWEEP_DELAY_MS);
      }
      return inner;
    });
    if (armed !== null) {
      await armed;
    }
    if (result.ok) {
      await this.drainOutbox();
    }
    return result;
  }

  // 登録して物理アラームを最小 due に張り直す（§9.6 の多重化）
  private armSweep(dueAt: number): Promise<void> {
    const min = registerAlarm(this.ctx.storage.sql, OUTBOX_SWEEP, dueAt);
    return this.ctx.storage.setAlarm(min);
  }

  private tenantId(): string | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM do_config WHERE key = 'tenant_id'")
      .toArray()[0];
    return row?.value ?? null;
  }

  // アウトボックスの排出。正常系は publish 直後に呼ぶ。失敗しても例外を投げない
  // （コミットは済んでいる。拾い直すのは sweeper の仕事 = §12.3 の「コミットの事実」に依存する保証）。
  private async drainOutbox(): Promise<void> {
    const tenantId = this.tenantId();
    if (tenantId === null) {
      console.error("outbox drain skipped: tenant id is unknown");
      return;
    }
    for (const row of unsentOutbox(this.ctx.storage.sql, 50)) {
      const job: ProjectionJob =
        row.jobType === "delete"
          ? {
              jobType: "delete",
              tenantId,
              recordId: row.recordId,
              sourceVersion: row.sourceVersion,
              publishSeq: row.publishSeq,
            }
          : {
              jobType: "upsert",
              tenantId,
              recordId: row.recordId,
              sourceVersion: row.sourceVersion,
              publishSeq: row.publishSeq,
            };
      try {
        // 送出してからマークする。逆順にするとメッセージを失う（重複は consumer が冪等に吸収する）。
        await this.env.PROJECTION_QUEUE.send(job);
        markOutboxSent(this.ctx.storage.sql, row.id);
      } catch (error) {
        console.error("outbox send failed", row.id, error);
        return; // 残りは sweeper に任せる
      }
    }
  }

  // テスト用: 未送出件数
  pendingOutbox(): number {
    return countUnsent(this.ctx.storage.sql);
  }

  override async alarm(): Promise<void> {
    // 物理アラームは複数の論理タイマーを多重化しているため、alarmInfo を見ても「どの kind が
    // 起きたか」は分からない ―― 到来した kind の判定は常にレジストリ（due_at）を見て行うので
    // 引数は使わない。effectiveNow は「alarm() が呼ばれたこと自体がレジストリの最早 due_at の
    // 到来を証明する」という前提のもと、早期起床やクロック誤差を吸収する（詳細は alarms.ts）。
    const now = effectiveNow(this.ctx.storage.sql);
    for (const kind of dueKinds(this.ctx.storage.sql, now)) {
      if (kind === OUTBOX_SWEEP) {
        await this.sweepOutbox();
      }
    }
    const min = minDueAt(this.ctx.storage.sql);
    if (min !== null) {
      await this.ctx.storage.setAlarm(min);
    }
  }

  private async sweepOutbox(): Promise<void> {
    await this.drainOutbox();
    // MIN() 意味論の登録では過去の due を前倒しのまま残してしまうので、消してから登録し直す
    clearAlarm(this.ctx.storage.sql, OUTBOX_SWEEP);
    if (countUnsent(this.ctx.storage.sql) > 0) {
      registerAlarm(this.ctx.storage.sql, OUTBOX_SWEEP, Date.now() + SWEEP_RETRY_MS);
      return;
    }
    // 全行送出済み → 登録を消して no-op で終わる（§12.3）
    purgeSent(this.ctx.storage.sql);
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
              nextPublishSeq: () => this.nextPublishSeq(),
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
