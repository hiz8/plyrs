import { CLOSE_CODES, KEEPALIVE_PING, SYNC_SUBPROTOCOL } from "@plyrs/sync-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserConnect } from "./browser";

interface FakeInstance {
  url: string;
  protocols: unknown;
  options: Record<string, unknown>;
  sent: string[];
  listeners: Map<string, ((event: unknown) => void)[]>;
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  emit(type: string, event: unknown): void;
}

const instances: FakeInstance[] = [];
// true にすると、次に作られるインスタンスは open ではなく error を発火する
let nextInstanceErrors = false;

function FakeWebSocket(
  this: FakeInstance,
  url: string,
  protocols: unknown,
  options: Record<string, unknown>,
) {
  this.url = url;
  this.protocols = protocols;
  this.options = options;
  this.sent = [];
  this.listeners = new Map();
  // 実 partysocket は構築直後 CONNECTING（0）。OPEN（1）になるのは後続ティックで
  // open が発火してから。
  this.readyState = 0;
  this.send = (data: string) => this.sent.push(data);
  this.close = () => {
    this.readyState = 3;
    this.emit("close", { code: 1000 });
  };
  this.addEventListener = (type: string, listener: (event: unknown) => void) => {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  };
  this.removeEventListener = (type: string, listener: (event: unknown) => void) => {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  };
  this.emit = (type: string, event: unknown) => {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  };
  instances.push(this);
  const shouldError = nextInstanceErrors;
  nextInstanceErrors = false;
  // 接続確立（または失敗）は後続ティックで通知する — 実ソケットの CONNECTING を模す
  queueMicrotask(() => {
    if (shouldError) {
      this.emit("error", {});
      return;
    }
    this.readyState = 1;
    this.emit("open", {});
  });
}

afterEach(() => {
  instances.length = 0;
  nextInstanceErrors = false;
  vi.useRealTimers();
});

describe("createBrowserConnect", () => {
  it("offers the sync subprotocol with a freshly fetched token", async () => {
    const getToken = vi.fn(async () => "jwt-1");
    const connect = createBrowserConnect({
      url: "wss://api.example/v1/t/t1/sync",
      getToken,
      WebSocketImpl: FakeWebSocket as never,
    });

    await connect();
    const created = instances[0];
    expect(created?.url).toBe("wss://api.example/v1/t/t1/sync");
    const protocolsFn = created?.protocols as (() => Promise<string[]>) | undefined;
    const protocols = await protocolsFn?.();
    expect(protocols).toEqual([SYNC_SUBPROTOCOL, "token.jwt-1"]);
    expect(getToken).toHaveBeenCalled();
  });

  it("does not resolve connect() until the socket reaches OPEN", async () => {
    const connect = createBrowserConnect({
      url: "wss://api.example/sync",
      getToken: async () => "jwt",
      WebSocketImpl: FakeWebSocket as never,
    });

    let resolved = false;
    const pending = connect().then((socket) => {
      resolved = true;
      return socket;
    });

    // FakeWebSocket のコンストラクタが同期的に呼ばれた直後はまだ CONNECTING。
    expect(instances[0]?.readyState).toBe(0);
    expect(resolved).toBe(false);

    const socket = await pending;
    expect(resolved).toBe(true);
    expect(socket.readyState).toBe(1);
  });

  it("rejects connect() when the socket errors before opening", async () => {
    nextInstanceErrors = true;
    const connect = createBrowserConnect({
      url: "wss://api.example/sync",
      getToken: async () => "jwt",
      WebSocketImpl: FakeWebSocket as never,
    });

    await expect(connect()).rejects.toThrow(/failed to open/);
  });

  it("passes maxEnqueuedMessages: 0 so the outbox owns buffering", async () => {
    const connect = createBrowserConnect({
      url: "wss://api.example/sync",
      getToken: async () => "jwt",
      WebSocketImpl: FakeWebSocket as never,
    });
    await connect();
    expect(instances[0]?.options["maxEnqueuedMessages"]).toBe(0);
  });

  it("never lets partysocket self-reconnect (engine is the single authority)", async () => {
    const connect = createBrowserConnect({
      url: "wss://api.example/sync",
      getToken: async () => "jwt",
      WebSocketImpl: FakeWebSocket as never,
    });
    await connect();
    const shouldReconnect = instances[0]?.options["shouldReconnectOnClose"] as (event: {
      code: number;
    }) => boolean;

    expect(shouldReconnect({ code: CLOSE_CODES.tokenExpired })).toBe(false);
    expect(shouldReconnect({ code: CLOSE_CODES.blocked })).toBe(false);
    expect(shouldReconnect({ code: 1006 })).toBe(false);
  });

  it("sends keepalive pings after open and stops on close", async () => {
    vi.useFakeTimers();
    const connect = createBrowserConnect({
      url: "wss://api.example/sync",
      getToken: async () => "jwt",
      keepaliveMs: 1000,
      WebSocketImpl: FakeWebSocket as never,
    });
    // open は queueMicrotask 経由で発火する。フェイクタイマーは setTimeout/setInterval
    // のみを差し替え、ネイティブのマイクロタスクキューには影響しないため、
    // 通常どおり await するだけで open まで進む。
    const socket = await connect();
    const created = instances[0];
    expect(created?.sent).toHaveLength(0);

    vi.advanceTimersByTime(2500);
    expect(created?.sent.filter((entry) => entry === KEEPALIVE_PING)).toHaveLength(2);

    socket.close();
    vi.advanceTimersByTime(5000);
    expect(created?.sent.filter((entry) => entry === KEEPALIVE_PING)).toHaveLength(2);
  });
});
