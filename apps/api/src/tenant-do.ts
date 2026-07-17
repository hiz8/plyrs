import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import * as schema from "@plyrs/db";
import migrations from "@plyrs/db/migrations";
import { ASSET_TYPE_KEY, contentTypeDefinitionSchema } from "@plyrs/metamodel";
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
import {
  listAssetOrphanIds as loadAssetOrphanIds,
  listAssetUsage as loadAssetUsage,
  type AssetUsageRow,
} from "./do/asset-usage";
import { requireOperation, type AuthContext } from "./do/authorize";
import {
  loadAllContentTypeRows,
  loadContentTypeByKey,
  registerContentTypeCore,
  type ContentTypeRow,
  type RegisterContentTypeResult,
} from "./do/content-types";
import { deleteRecordCore, type DeleteRecordResult } from "./do/delete-record";
import { ensureAssetContentType } from "./do/ensure-asset-type";
import { countUnsent, markOutboxSent, purgeSent, unsentOutbox } from "./do/outbox";
import {
  loadProjectionPayload,
  loadPublicationState,
  loadPublishedPage,
  publishRecordCore,
  unpublishRecordCore,
  type PublicationState,
  type PublishResult,
  type UnpublishResult,
} from "./do/publish";
import { loadRecord, writeRecordCore } from "./do/write-record";
import type { RecordSnapshot, WriteRecordInput, WriteRecordResult } from "./do/types";
import type { ProjectionJob } from "./projection/jobs";
import {
  catalogRowsForFields,
  type CatalogRow,
  type ProjectionPayload,
} from "./projection/payload";
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
      // Phase 8 裁定 2: システム asset 型を自動登録(冪等)。Phase 8 デプロイ以前から存在する
      // テナントも、次に DO が起きた時点でここを通って型を得る。変更があった時だけ、
      // hibernation 復帰で生きているソケットへ型カタログを配り直す(registerContentType RPC の
      // broadcast と同じ契約 — G1: content_types は seq を消費しない別チャネル)。
      const assetTypeChanged = ensureAssetContentType(ctx.storage.sql, new Date().toISOString());
      if (assetTypeChanged) {
        this.broadcastAll({
          type: "content-types",
          contentTypes: loadAllContentTypes(ctx.storage.sql),
        });
      }
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

  // Phase 6a: 管理画面の content_type 一覧（読み取り専用）。key 昇順は SQL 側で保証される。
  listContentTypes(): ContentTypeRow[] {
    return loadAllContentTypeRows(this.ctx.storage.sql);
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

  // Phase 8 裁定 1: asset record の作成・システム管理フィールドの書き込みはアップロード API
  // 専用の経路。writeRecord と同じコアを systemWrite で通す(assetGuardHook だけが免除される —
  // unique 検証や validate-on-write は同じに掛かる)。
  createAssetRecord(params: WriteRecordInput, auth: AuthContext): WriteRecordResult {
    const denial = requireOperation(auth, "record:write");
    if (denial !== null) {
      return denial;
    }
    const contentType = loadContentTypeByKey(this.ctx.storage.sql, ASSET_TYPE_KEY);
    if (contentType === null) {
      return { ok: false, code: "unknown_type", message: "asset type is not registered" };
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
        { systemWrite: true },
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

  // Phase 6b: 公開状態の読み取り（読み取り系は getRecord と同じく role 不問 — authorize.ts 冒頭コメント参照）
  getPublication(recordId: string): PublicationState {
    return loadPublicationState(this.ctx.storage.sql, recordId);
  }

  // Phase 8 裁定 6: 読み取り系は getRecord と同じく role 不問(authorize.ts 冒頭コメントの既存規律)
  listAssetOrphanIds(): string[] {
    return loadAssetOrphanIds(this.ctx.storage.sql);
  }

  listAssetUsage(assetId: string): AssetUsageRow[] {
    return loadAssetUsage(this.ctx.storage.sql, assetId);
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
      // MINOR fix（レビュー指摘）: 未公開レコードの削除は cascadeUnpublish が outbox に
      // 何も積まない。実際に outbox 行が積まれた時だけ sweep を張り、無駄な DO 起床を避ける。
      if (inner.ok && countUnsent(this.ctx.storage.sql) > 0) {
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
    tenantSlug: string,
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
        tenantSlug,
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

  // sweep は kind 全体を無条件に消してから、未送出が残っていれば SWEEP_RETRY_MS 後に登録し直す
  // （MIN() 意味論の登録では過去の due をそのまま残してしまうため、消してからでないと前倒しできない）。
  // drainOutbox() の await 中は DO の input gate が保持されないため、この消去は「sweep が始まった
  // 後に別の publish/unpublish/delete/push が張った新しい登録」も巻き添えで消しうる。ただし、その
  // 割り込んだ操作自身も自分の transactionSync 直後に armSweep + drainOutbox（速い経路）で自分の
  // outbox 行を排出済みなので、実害が出るのは「その割り込んだ操作自身の drain も失敗していた」
  // 場合に限られる ―― そのときは次のアラームが SWEEP_DELAY_MS(5s) ではなく SWEEP_RETRY_MS(30s)
  // 後になるだけで、正しさ（§12.3: いずれ拾われる）は損なわれない。これを許容される最悪ケースとして
  // 明示的に受け入れる。
  private async sweepOutbox(): Promise<void> {
    await this.drainOutbox();
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

  // Finding 3（important）: 再投影の終端 sweep が使う。カタログ（projection_fields）は record の
  // 投影 upsert への相乗りでしか更新されないため、全件 unpublish 済みの型は歩きのページ読み取りに
  // 一度も乗らず、宣言（content_types）が生きていても sweep がカタログ行を消してしまう
  // （projection/consumer.ts の handleReprojectJob 参照）。カタログは公開レコードの有無ではなく
  // 「宣言があるか」だけに依存するべき派生物なので、record とは独立に content_types から
  // 直接作り直せる経路を用意する。
  getProjectionCatalog(): { type: string; catalog: CatalogRow[] }[] {
    return loadAllContentTypeRows(this.ctx.storage.sql).map((row) => ({
      type: row.key,
      catalog: catalogRowsForFields(row.fields),
    }));
  }

  // §12.3b: テナント単位の再投影を開始する（owner 限定）。epoch を刻んで最初の reproject
  // ジョブ（cursor: null）を 1 件送出するだけ — ページングと mark-and-sweep は consumer 側。
  async startReprojection(
    tenantId: string,
    auth: AuthContext,
  ): Promise<{ ok: true; epoch: number } | { ok: false; code: "forbidden"; message: string }> {
    const denial = requireOperation(auth, "projection:rebuild");
    if (denial !== null) {
      return denial;
    }
    this.ctx.storage.transactionSync(() => {
      this.rememberTenant(tenantId);
    });
    const epoch = Date.now();
    // 再投影は outbox を経由しない（publish のような原子性要求が無く、失敗しても再実行すれば足りる）
    await this.env.PROJECTION_QUEUE.send({ jobType: "reproject", tenantId, cursor: null, epoch });
    return { ok: true, epoch };
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
      // CRITICAL fix（レビュー指摘）: push 経路の delete は deleteRecordCore → cascadeUnpublish
      // 経由で outbox に delete 行を積みうる（裁定 2026-07-13）。deleteRecord/publishRecord/
      // unpublishRecord の各 RPC 経路はコミット直後に sweep を張って outbox を排出するが、
      // この経路だけそれを欠いていた ―― レジストリが空のままだと constructor の再アーム保険も
      // 効かず、以後このテナントで publish/unpublish/HTTP delete が一度も呼ばれなければ、
      // コミット済みの unpublish が outbox に永遠に取り残される（公開停止したはずのレコードが
      // 投影に残り続ける）。setAlarm は transactionSync に参加し、ロールバックで巻き戻る
      // （実証済み）。クロージャ内では await できないので promise を掴み、トランザクションを
      // 出てから待つ。
      let armed: Promise<void> | null = null;
      try {
        // 変異はトランザクション内。ブロードキャストはコミット後（未コミットの seq を見せない）。
        outcome = this.ctx.storage.transactionSync(() => {
          const inner = handlePush(
            {
              sql: this.ctx.storage.sql,
              nextSeq: () => ++this.seq,
              now: () => new Date().toISOString(),
              newRelationId: () => uuidv7(),
              nextPublishSeq: () => this.nextPublishSeq(),
            },
            parsed.changes,
            { userId: auth.userId, role: auth.role },
          );
          // 実際に outbox 行が積まれた時だけ張る（大半の push は upsert のみで outbox に触れない）。
          if (countUnsent(this.ctx.storage.sql) > 0) {
            armed = this.armSweep(Date.now() + SWEEP_DELAY_MS);
          }
          return inner;
        });
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
      if (armed !== null) {
        await armed;
      }
      for (const ackMessage of outcome.acks) {
        this.send(ws, ackMessage);
      }
      for (const broadcastMessage of outcome.broadcasts) {
        this.broadcast(ws, broadcastMessage);
      }
      // MINOR fix（レビュー指摘）: rememberTenant は publish/unpublish/startReprojection でしか
      // 呼ばれないため、型登録とレコード書き込みしかしていないテナントには do_config に
      // tenant_id が無い。drainOutbox() を毎 push 無条件に呼ぶと、そのテナントの push（同期の
      // 最も高頻度な経路）が毎回 tenant id 不明のエラーログを吐く。outbox に実際に行が積まれて
      // sweep を張った時（armed !== null）だけ排出を試みる ―― drainOutbox 自身の
      // 「tenant unknown → ログして return」はそれでも保険として残す。
      if (armed !== null) {
        // drainOutbox はコミット後のベストエフォート排出。ack/broadcast は既に送信済みなので、
        // 失敗しても例外を投げず、拾い直しは sweeper に任せる（drainOutbox 自身の契約）。
        await this.drainOutbox();
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
