import type { ServerMessage } from "@plyrs/sync-protocol";
import type { WebSocketLike } from "@plyrs/sync-client";

// 実物の WebSocket は close/message をタスクとしてキューイングし、close() の同期
// コンテキスト内では発火させない（WHATWG）。フェイクもその挙動に合わせる。
export class FakeSocket implements WebSocketLike {
  readyState = 1;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    queueMicrotask(() => this.emit("close", { code, reason }));
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  deliver(message: ServerMessage): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  parsed(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw));
  }
}

// 接続が確立しない ConnectFn（シェルのテスト用: status は connecting のまま止まる）
export function pendingConnect(): Promise<WebSocketLike> {
  return new Promise<WebSocketLike>(() => {});
}
