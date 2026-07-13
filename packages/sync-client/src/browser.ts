import {
  CLOSE_CODES,
  KEEPALIVE_PING,
  SYNC_SUBPROTOCOL,
  TOKEN_PROTOCOL_PREFIX,
} from "@plyrs/sync-protocol";
import { WebSocket as ReconnectingWebSocket } from "partysocket";
import type { ConnectFn, WebSocketLike } from "./transport";

const DEFAULT_KEEPALIVE_MS = 30_000;

export interface BrowserTransportOptions {
  url: string;
  getToken: () => Promise<string>;
  keepaliveMs?: number;
  // テスト用の差し替え口（本番は partysocket）
  WebSocketImpl?: typeof ReconnectingWebSocket;
}

// ブラウザ用トランスポート。トークンは Sec-WebSocket-Protocol で運ぶ（WS に
// Authorization ヘッダを付けられないため）。再接続のたびに最新トークンを載せる。
export function createBrowserConnect(options: BrowserTransportOptions): ConnectFn {
  const Impl = options.WebSocketImpl ?? ReconnectingWebSocket;
  const keepaliveMs = options.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;

  return async () => {
    const socket = new Impl(
      options.url,
      async () => [SYNC_SUBPROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${await options.getToken()}`],
      {
        // 4001（失効）/ 4003（BAN）はエンジンが処理する。partysocket の自動再接続は止める。
        shouldReconnectOnClose: (event: { code: number }) =>
          event.code !== CLOSE_CODES.tokenExpired && event.code !== CLOSE_CODES.blocked,
        // 未接続時のバッファはアウトボックスが持つ
        maxEnqueuedMessages: 0,
      },
    ) as unknown as WebSocketLike & { addEventListener: WebSocketLike["addEventListener"] };

    // partysocket にハートビートは無い。サーバーは auto-response で DO を起こさず pong を返す。
    const timer = setInterval(() => {
      socket.send(KEEPALIVE_PING);
    }, keepaliveMs);
    socket.addEventListener("close", () => clearInterval(timer));

    return socket;
  };
}
