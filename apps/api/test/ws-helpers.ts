import type { ServerMessage } from "@plyrs/sync-protocol";
import { SYNC_SUBPROTOCOL } from "@plyrs/sync-protocol";
import type { SocketAuth } from "../src/sync/session";
import { AUTH_HEADER } from "../src/sync/session";

// vitest-pool-workers: stub.fetch が返す Response.webSocket のクライアント端は
// 自動 accept されない（ブラウザの WebSocket と違う）。明示的に accept する。
// Worker 経由の経路は `app.request` で別途テストするため、ヘルパーは DO 直結・
// 検証済みヘッダ注入とする。
export async function openSyncSocket(
  stub: { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> },
  auth: SocketAuth,
): Promise<{ socket: WebSocket; response: Response }> {
  const response = await stub.fetch("https://do/sync", {
    headers: {
      upgrade: "websocket",
      "sec-websocket-protocol": SYNC_SUBPROTOCOL,
      [AUTH_HEADER]: JSON.stringify(auth),
    },
  });
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error(`upgrade failed: ${response.status}`);
  }
  socket.accept();
  return { socket, response };
}

export function nextMessage(socket: WebSocket, timeoutMs = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for a message")), timeoutMs);
    socket.addEventListener(
      "message",
      (event: MessageEvent) => {
        clearTimeout(timer);
        const data = typeof event.data === "string" ? event.data : "";
        resolve(JSON.parse(data) as ServerMessage);
      },
      { once: true },
    );
  });
}

export async function nextMessages(socket: WebSocket, count: number): Promise<ServerMessage[]> {
  const messages: ServerMessage[] = [];
  for (let i = 0; i < count; i += 1) {
    messages.push(await nextMessage(socket));
  }
  return messages;
}

export function closeInfo(
  socket: WebSocket,
  timeoutMs = 5000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for close")), timeoutMs);
    socket.addEventListener(
      "close",
      (event: CloseEvent) => {
        clearTimeout(timer);
        resolve({ code: event.code, reason: event.reason });
      },
      { once: true },
    );
  });
}
