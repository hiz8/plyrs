// エンジンは partysocket にも DOM の WebSocket にも依存しない。
// ブラウザでは partysocket（src/browser.ts）、テストではフェイクや
// workerd の実ソケットを同じ形で差し込む。
export const SOCKET_OPEN = 1;

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message" | "open" | "close" | "error",
    listener: (event: SocketEvent) => void,
  ): void;
  removeEventListener(
    type: "message" | "open" | "close" | "error",
    listener: (event: SocketEvent) => void,
  ): void;
}

export interface SocketEvent {
  data?: unknown;
  code?: number;
  reason?: string;
}

export type ConnectFn = () => Promise<WebSocketLike>;
