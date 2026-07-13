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
  this.readyState = 1;
  this.send = (data: string) => this.sent.push(data);
  this.close = () => {
    this.readyState = 3;
    this.emit("close", { code: 1000 });
  };
  this.addEventListener = (type: string, listener: (event: unknown) => void) => {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  };
  this.removeEventListener = () => undefined;
  this.emit = (type: string, event: unknown) => {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  };
  instances.push(this);
  // 接続確立を即時に通知する
  queueMicrotask(() => this.emit("open", {}));
}

afterEach(() => {
  instances.length = 0;
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
    // eslint-disable-next-line no-unsafe-optional-chaining
    const protocols = await (created?.protocols as () => Promise<string[]>)();
    expect(protocols).toEqual([SYNC_SUBPROTOCOL, "token.jwt-1"]);
    expect(getToken).toHaveBeenCalled();
  });

  it("blocks partysocket's auto-reconnect on 4001 and 4003", async () => {
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
    expect(shouldReconnect({ code: 1006 })).toBe(true);
  });

  it("sends keepalive pings and stops on close", async () => {
    vi.useFakeTimers();
    const connect = createBrowserConnect({
      url: "wss://api.example/sync",
      getToken: async () => "jwt",
      keepaliveMs: 1000,
      WebSocketImpl: FakeWebSocket as never,
    });
    const socket = await connect();
    const created = instances[0];

    vi.advanceTimersByTime(2500);
    expect(created?.sent.filter((entry) => entry === KEEPALIVE_PING)).toHaveLength(2);

    socket.close();
    vi.advanceTimersByTime(5000);
    expect(created?.sent.filter((entry) => entry === KEEPALIVE_PING)).toHaveLength(2);
  });
});
