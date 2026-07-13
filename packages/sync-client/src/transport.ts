// エンジンはブラウザ向け再接続ラッパーライブラリにも workerd の WebSocket にも依存しない。
// イベント型を unknown にすることで、DOM lib の有無に関わらず両方の WebSocket を
// 構造的に受け入れられる（独自のイベント型を使う版は、DOM lib が暗黙に有効で
// その非ジェネリックな addEventListener オーバーロードに一致することに依存していた）。
// イベントから必要な値は下のナローイングヘルパで取り出す。
export const SOCKET_OPEN = 1;

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message" | "open" | "close" | "error",
    listener: (event: unknown) => void,
  ): void;
  removeEventListener(
    type: "message" | "open" | "close" | "error",
    listener: (event: unknown) => void,
  ): void;
}

export type ConnectFn = () => Promise<WebSocketLike>;

// data が無い場合に加えて、バイナリフレーム（ArrayBuffer など）でも null を返す。
// 本プロトコルは JSON テキストのみなのでバイナリは想定外。
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
