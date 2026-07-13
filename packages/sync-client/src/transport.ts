// エンジンは partysocket にも workerd の WebSocket にも依存しない。
// イベント型を unknown にして両方を構造的に受け入れ、必要な値は下のヘルパで取り出す
// （workers-types の addEventListener は WebSocketEventMap 上のジェネリックであり、
//  optional のみの独自イベント型では代入不能になるため）。
export const SOCKET_OPEN = 1;

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export type ConnectFn = () => Promise<WebSocketLike>;

export function socketMessageData(event: unknown): string | null {
  if (typeof event !== "object" || event === null || !("data" in event)) {
    return null;
  }
  const data = (event as { data: unknown }).data;
  return typeof data === "string" ? data : null;
}

export function socketCloseCode(event: unknown, fallback = 1006): number {
  if (typeof event !== "object" || event === null || !("code" in event)) {
    return fallback;
  }
  const code = (event as { code: unknown }).code;
  return typeof code === "number" ? code : fallback;
}
