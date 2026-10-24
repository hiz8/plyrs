import type { Handler } from "./api-stubs";

// K7: アップロード(XHR)を使うテストの下地。stubFetch と同じ routes(パス → Handler)を引き、
// send(body) で handler を呼んで status / responseText を写す。upload に progress(送信直後に 50%、
// 応答のあとに 100%)→ load を発火する。Handler が保留中の Promise なら、解決まで load を待つ。
// admin-api が使う範囲(open / setRequestHeader / send / abort / addEventListener /
// upload.addEventListener / status / responseText)だけを実装する

interface FakeProgressEvent {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

type Listener<E> = (event: E) => void;

class Emitter<E> {
  private readonly listeners = new Map<string, Listener<E>[]>();

  addEventListener(type: string, listener: Listener<E>): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, event: E): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeXhr extends Emitter<FakeProgressEvent | undefined> {
  status = 0;
  responseText = "";
  readonly upload = new Emitter<FakeProgressEvent>();
  private url = "";
  private method = "";
  private readonly headers: Record<string, string> = {};
  private aborted = false;

  constructor(private readonly routes: Record<string, Handler>) {
    super();
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.emit("abort", undefined);
  }

  send(body: Blob): void {
    void this.run(body);
  }

  private async run(body: Blob): Promise<void> {
    const handler = this.routes[this.url.split("?")[0] ?? this.url];
    if (handler === undefined) {
      this.emit("error", undefined);
      return;
    }
    // 送信の途中(50%)は handler の応答を待つあいだに見えるようにし、100% と load は応答のあと
    this.progress(Math.floor(body.size / 2), body.size);
    let response: Response;
    let text: string;
    try {
      response = await handler({ method: this.method, headers: this.headers, body });
      text = await response.text();
    } catch {
      // handler の例外はネットワークエラー扱い(テストがハングしないように)
      if (!this.aborted) this.emit("error", undefined);
      return;
    }
    if (this.aborted) return;
    this.status = response.status;
    this.responseText = text;
    this.progress(body.size, body.size);
    this.emit("load", undefined);
  }

  private progress(loaded: number, total: number): void {
    this.upload.emit("progress", { lengthComputable: true, loaded, total });
  }
}

export function createFakeXhr(routes: Record<string, Handler>): () => XMLHttpRequest {
  // 実 XHR の全体は再現しない最小実装なので、境界でだけ XMLHttpRequest として扱う
  return () => new FakeXhr(routes) as unknown as XMLHttpRequest;
}
