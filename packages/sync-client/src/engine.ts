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

export interface SyncEngineOptions {
  connect: ConnectFn;
  storage?: SyncStorage;
  onStoreChange?: (change: StoreChange) => void;
  onContentTypes?: (types: ContentTypeDefinition[]) => void;
  onReady?: () => void;
  onStatus?: (status: SyncStatus) => void;
  onReset?: () => void;
  refreshToken?: () => Promise<void>;
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
    this.stopped = false;
    this.currentCheckpoint = await this.storage.loadCheckpoint();
    await this.outbox.hydrate();
    await this.open();
  }

  async stop(): Promise<void> {
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
    this.setStatus("connecting");
    this.readySent = false;
    const socket = await this.options.connect();
    this.socket = socket;
    socket.addEventListener("message", this.onMessage);
    socket.addEventListener("close", this.onClose);
    this.setStatus("syncing");
    this.sendHello();
  }

  private sendHello(): void {
    this.send({ type: "hello", checkpoint: this.currentCheckpoint });
  }

  private readonly onMessage = (event: unknown): void => {
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
  };

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

  private readonly onClose = (event: unknown): void => {
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
  };

  private async terminate(error: Error): Promise<void> {
    this.setStatus("closed");
    await this.outbox.failAll(error);
  }

  private async reconnect(code: number): Promise<void> {
    if (code === CLOSE_CODES.tokenExpired) {
      // ソケット内のトークン更新は無い。新トークンを取ってから張り直す。
      await this.options.refreshToken?.();
    }
    if (this.stopped) {
      return;
    }
    try {
      await this.open();
    } catch (error) {
      await this.terminate(error instanceof Error ? error : new Error("reconnect failed"));
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
