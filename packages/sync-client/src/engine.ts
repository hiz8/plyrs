import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { ClientChange, ServerMessage, SyncRecord } from "@plyrs/sync-protocol";
import { CLOSE_CODES, KEEPALIVE_PONG, MAX_CHANGES_PER_PUSH } from "@plyrs/sync-protocol";
import { Outbox } from "./outbox";
import { MemorySyncStorage, type SyncStorage } from "./storage";
import { RecordStore, type StoreChange } from "./store";
import {
  SOCKET_OPEN,
  socketCloseCode,
  socketMessageData,
  type ConnectFn,
  type WebSocketLike,
} from "./transport";

export type SyncStatus = "idle" | "connecting" | "syncing" | "ready" | "closed";

const DEFAULT_RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];

export interface SyncEngineOptions {
  connect: ConnectFn;
  storage?: SyncStorage;
  onStoreChange?: (change: StoreChange) => void;
  onContentTypes?: (types: ContentTypeDefinition[]) => void;
  onReady?: () => void;
  onStatus?: (status: SyncStatus) => void;
  onReset?: () => void;
  refreshToken?: () => Promise<void>;
  // 再接続の待ち時間（ms）。使い切ると接続を終端する。テストは [0,0] のように短縮できる。
  reconnectDelaysMs?: number[];
}

export class SyncEngine {
  readonly store = new RecordStore();

  private readonly options: SyncEngineOptions;
  private readonly storage: SyncStorage;
  private readonly outbox: Outbox;
  private socket: WebSocketLike | null = null;
  private currentStatus: SyncStatus = "idle";
  private currentCheckpoint = 0;
  private readySent = false;
  private stopped = false;
  // start()/stop() のたびに進む世代カウンタ。connect() の await 中に stop()/start() が
  // 割り込んでも、古い世代のソケットを孤児にせず閉じて捨てるための目印。
  private generation = 0;

  constructor(options: SyncEngineOptions) {
    this.options = options;
    this.storage = options.storage ?? new MemorySyncStorage();
    this.outbox = new Outbox(this.storage);
  }

  get status(): SyncStatus {
    return this.currentStatus;
  }

  get checkpoint(): number {
    return this.currentCheckpoint;
  }

  async start(): Promise<void> {
    this.generation += 1;
    // 接続済みのソケットが残っていれば孤児にせず閉じる（再接続ボタンやテナント切替で
    // start() が接続中に再度呼ばれるケースに備える）。ブラウザ実装のキープアライブ
    // タイマーは close イベントでのみ止まるため、開いたまま放置すると ping を送り続ける。
    this.socket?.close(1000, "client_restart");
    this.socket = null;
    this.stopped = false;
    // このメソッド呼び出しの間に stop()/start() が割り込んでも巻き込まれないよう、
    // 世代はここで一度だけ確定させて以降 this.generation を読み直さない。
    const generation = this.generation;
    this.currentCheckpoint = await this.storage.loadCheckpoint();
    await this.outbox.hydrate();
    // 初回接続もバックオフの対象にする。ここで失敗しても start() 自体は reject しない。
    // 失敗のシグナルは status "closed" になる（サーバーに到達できないだけなら
    // アウトボックスは温存される。詳しくは setOffline/terminate を参照）。
    await this.connectWithBackoff(generation);
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.stopped = true;
    this.socket?.close(1000, "client_stop");
    this.socket = null;
    this.setStatus("closed");
  }

  async push(change: ClientChange): Promise<SyncRecord> {
    const { acked } = await this.outbox.enqueue(change);
    this.flush();
    return acked;
  }

  private async open(): Promise<void> {
    const generation = this.generation;
    this.setStatus("connecting");
    this.readySent = false;
    const socket = await this.options.connect();
    // await 中に stop()/start() が走っていたら、このソケットは孤児にせず閉じて捨てる
    if (this.stopped || generation !== this.generation) {
      socket.close(1000, "client_stop");
      return;
    }
    this.socket = socket;
    socket.addEventListener("message", (event) => this.handleMessage(event, socket, generation));
    socket.addEventListener("close", (event) => this.handleClose(event, socket, generation));
    this.setStatus("syncing");
    this.sendHello();
  }

  private sendHello(): void {
    this.send({ type: "hello", checkpoint: this.currentCheckpoint });
  }

  // socket/generation を閉じ込めているのは、世代交代後もこの listener 自体は古い
  // ソケットに付いたまま残るため（addEventListener の解除はしていない）。遅れて発火
  // しても現行世代の状態を書き換えないようにする。
  private handleMessage(event: unknown, socket: WebSocketLike, generation: number): void {
    if (this.socket !== socket || generation !== this.generation) {
      return;
    }
    const raw = socketMessageData(event);
    if (raw === null || raw === KEEPALIVE_PONG) {
      return;
    }
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    void this.handle(message);
  }

  private async handle(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case "welcome": {
        this.options.onContentTypes?.(message.contentTypes);
        // ロードマップ §7: serverSeq が手元 checkpoint より小さい = サーバーリセット
        if (message.serverSeq < this.currentCheckpoint) {
          this.store.clear();
          this.options.onReset?.();
          this.currentCheckpoint = 0;
          await this.storage.saveCheckpoint(0);
          this.sendHello();
        }
        return;
      }
      case "sync": {
        for (const record of message.records) {
          this.applyRecord(record);
        }
        // ロードマップ §7: complete を受けてから checkpoint を前進させる
        if (message.complete) {
          this.currentCheckpoint = message.serverSeq;
          await this.storage.saveCheckpoint(message.serverSeq);
          this.setStatus("ready");
          if (!this.readySent) {
            this.readySent = true;
            this.options.onReady?.();
          }
          this.flush();
        }
        return;
      }
      case "change": {
        this.applyRecord(message.record);
        return;
      }
      case "content-types": {
        this.options.onContentTypes?.(message.contentTypes);
        return;
      }
      case "ack": {
        if (message.result.ok) {
          this.applyRecord(message.result.record);
        }
        await this.outbox.settle(message.changeId, message.result);
        return;
      }
      case "error": {
        return;
      }
    }
  }

  private applyRecord(record: SyncRecord): void {
    const change = this.store.apply(record);
    if (change !== null) {
      this.options.onStoreChange?.(change);
    }
  }

  // 世代交代後に古いソケットが遅れて close を発火しても、現行ソケット/状態を
  // 巻き込まない（this.socket を誤って null にしたり、現行世代に無関係な
  // reconnect を起動したりしない）。
  private handleClose(event: unknown, socket: WebSocketLike, generation: number): void {
    if (this.socket !== socket || generation !== this.generation) {
      return;
    }
    this.socket = null;
    if (this.stopped) {
      return;
    }
    const code = socketCloseCode(event);
    if (code === CLOSE_CODES.blocked) {
      void this.terminate(new Error("blocked by the server"));
      return;
    }
    void this.reconnect(code);
  }

  // 接続できないだけ（オフライン等）ではアウトボックスを捨てない。
  // 未送信の変更は永続化したまま保持し、次の start() で再送する。
  private setOffline(): void {
    this.setStatus("closed");
  }

  // サーバーが当該クライアントを確定的に拒否した場合のみ、保留中の変更を棄却する。
  private async terminate(error: Error): Promise<void> {
    this.setStatus("closed");
    await this.outbox.failAll(error);
  }

  private async reconnect(code: number): Promise<void> {
    // refreshToken() の await 中に stop()/start() が割り込むケースに備えて、
    // この reconnect 呼び出しが属する世代を最初に確定させる。
    const generation = this.generation;
    if (code === CLOSE_CODES.tokenExpired) {
      // ソケット内のトークン更新は無い。新トークンを取ってから張り直す。
      try {
        await this.options.refreshToken?.();
      } catch {
        // トークン再取得に失敗した = 今は接続できない。アウトボックスは保持したまま offline に落とす。
        this.setOffline();
        return;
      }
    }
    await this.connectWithBackoff(generation);
  }

  // start()（初回接続）と reconnect()（切断後の再接続）が共有するバックオフループ。
  // 呼び出し元が確定させた世代を渡してもらい、それが古くなっていれば何もしない。
  private async connectWithBackoff(generation: number): Promise<void> {
    const delays = this.options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
    for (let attempt = 0; ; attempt += 1) {
      if (this.stopped || generation !== this.generation) {
        return;
      }
      try {
        await this.open();
        return;
      } catch {
        const delay = delays[attempt];
        if (delay === undefined) {
          // 全ての再試行を使い切ってもサーバーに到達できない = オフライン扱い。
          // これは「拒否された」わけではないので、アウトボックスは温存する。
          this.setOffline();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private flush(): void {
    const pending = this.outbox.pending();
    if (pending.length === 0 || this.socket === null || this.socket.readyState !== SOCKET_OPEN) {
      return;
    }
    for (let index = 0; index < pending.length; index += MAX_CHANGES_PER_PUSH) {
      this.send({ type: "push", changes: pending.slice(index, index + MAX_CHANGES_PER_PUSH) });
    }
  }

  private send(
    message: { type: "hello"; checkpoint: number } | { type: "push"; changes: ClientChange[] },
  ): void {
    if (this.socket === null || this.socket.readyState !== SOCKET_OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private setStatus(status: SyncStatus): void {
    if (this.currentStatus === status) {
      return;
    }
    this.currentStatus = status;
    this.options.onStatus?.(status);
  }
}
