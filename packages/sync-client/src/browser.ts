import { KEEPALIVE_PING, SYNC_SUBPROTOCOL, TOKEN_PROTOCOL_PREFIX } from "@plyrs/sync-protocol";
import { WebSocket as ReconnectingWebSocket } from "partysocket";
import type { ConnectFn, WebSocketLike } from "./transport";

const DEFAULT_KEEPALIVE_MS = 30_000;
const DEFAULT_OPEN_TIMEOUT_MS = 10_000;

export interface BrowserTransportOptions {
  url: string;
  getToken: () => Promise<string>;
  keepaliveMs?: number;
  // OPEN を待つ上限（ms）。超えたら connect() が reject する。
  openTimeoutMs?: number;
  // テスト用の差し替え口（本番は partysocket）
  WebSocketImpl?: typeof ReconnectingWebSocket;
}

// ブラウザ用トランスポート。トークンは Sec-WebSocket-Protocol で運ぶ（WS に
// Authorization ヘッダを付けられないため）。再接続のたびに最新トークンを載せる。
export function createBrowserConnect(options: BrowserTransportOptions): ConnectFn {
  const Impl = options.WebSocketImpl ?? ReconnectingWebSocket;
  const keepaliveMs = options.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;

  return async () => {
    const socket: WebSocketLike = new Impl(
      options.url,
      async () => [SYNC_SUBPROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${await options.getToken()}`],
      {
        // 再接続はエンジンが一元管理する（4001 のトークン再取得も含む）。
        // partysocket 自身に再接続させると、エンジンが張る新しいソケットと二重化して接続が漏れる。
        shouldReconnectOnClose: () => false,
        // 未接続時のバッファはアウトボックスが持つ
        maxEnqueuedMessages: 0,
      },
    );

    // 実 partysocket は構築直後 CONNECTING。OPEN になる前に hello を送ると黙って捨てられるため、
    // OPEN を待ってから ConnectFn を解決する。
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        socket.close();
        reject(new Error("websocket open timed out"));
      }, options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS);
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("websocket failed to open"));
      };
      function cleanup() {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      }
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });

    // partysocket にハートビートは無い。サーバーは auto-response で DO を起こさず pong を返す。
    const timer = setInterval(() => {
      socket.send(KEEPALIVE_PING);
    }, keepaliveMs);
    socket.addEventListener("close", () => clearInterval(timer));

    return socket;
  };
}
