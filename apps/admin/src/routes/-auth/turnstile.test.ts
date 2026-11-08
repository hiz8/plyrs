import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnstileApi } from "./turnstile";

const SCRIPT_SELECTOR = 'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]';

function fakeApi(): TurnstileApi {
  return { render: vi.fn(() => "widget-1"), reset: vi.fn(), remove: vi.fn() };
}

function findInjectedScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
}

// onload のコールバック名は "?onload=<name>" として script の src に埋め込まれる仕様
// (loadTurnstile の内部実装)。名前をハードコードせず src から読み取ることで、実装が
// 生成した名前をそのまま呼び出す(brief の「?render=explicit&onload=<一意な名前>」の検証を兼ねる)。
function triggerOnload(script: HTMLScriptElement, api: TurnstileApi): void {
  const onloadName = new URL(script.src).searchParams.get("onload");
  if (onloadName === null) {
    throw new Error("onload param is missing from the injected script src");
  }
  vi.stubGlobal("turnstile", api);
  const onload = (window as unknown as Record<string, (() => void) | undefined>)[onloadName];
  if (onload === undefined) {
    throw new Error(`onload callback "${onloadName}" was not registered on window`);
  }
  onload();
}

// loadTurnstile はモジュールスコープの Promise を使い回す(idempotent 実装の要件そのもの)。
// テスト間でその状態が漏れないよう、毎回モジュールをリセットして動的 import し直す。
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll("script").forEach((el) => el.remove());
});

describe("loadTurnstile", () => {
  it("injects the script with explicit render + onload params, only once", async () => {
    const { loadTurnstile } = await import("./turnstile");
    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(first).toBe(second); // 二重呼び出しは同じ Promise(idempotent)
    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1);
    const script = findInjectedScript();
    expect(script).not.toBeNull();
    const url = new URL(script?.src ?? "");
    expect(url.searchParams.get("render")).toBe("explicit");
    expect(url.searchParams.get("onload")).not.toBeNull();
  });

  it("resolves with window.turnstile once the injected script calls its onload callback", async () => {
    const { loadTurnstile } = await import("./turnstile");
    const promise = loadTurnstile();
    const script = findInjectedScript();
    if (script === null) throw new Error("script not injected");
    const api = fakeApi();
    triggerOnload(script, api);
    await expect(promise).resolves.toBe(api);
  });

  it("resolves immediately without injecting a script when window.turnstile already exists", async () => {
    const api = fakeApi();
    vi.stubGlobal("turnstile", api);
    const { loadTurnstile } = await import("./turnstile");
    await expect(loadTurnstile()).resolves.toBe(api);
    expect(findInjectedScript()).toBeNull();
  });

  it("rejects when the script fails to load", async () => {
    const { loadTurnstile } = await import("./turnstile");
    const promise = loadTurnstile();
    const script = findInjectedScript();
    if (script === null) throw new Error("script not injected");
    script.dispatchEvent(new Event("error"));
    await expect(promise).rejects.toThrow();
  });

  it("resets state on failure so a subsequent call injects a new script", async () => {
    const { loadTurnstile } = await import("./turnstile");
    const first = loadTurnstile();
    const firstScript = findInjectedScript();
    if (firstScript === null) throw new Error("script not injected");
    const onloadName = new URL(firstScript.src).searchParams.get("onload") ?? "";
    firstScript.dispatchEvent(new Event("error"));
    await expect(first).rejects.toThrow();
    // 失敗した script は DOM から除去され、onload グローバルも残っていないはず
    expect(findInjectedScript()).toBeNull();
    expect((window as unknown as Record<string, (() => void) | undefined>)[onloadName]).toBe(
      undefined,
    );

    const second = loadTurnstile();
    expect(second).not.toBe(first); // rejected promise を再利用しない
    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1); // 新しい script が 1 本注入される
    expect(findInjectedScript()).not.toBe(firstScript);
  });

  it("deletes the onload global once the load succeeds", async () => {
    const { loadTurnstile } = await import("./turnstile");
    const promise = loadTurnstile();
    const script = findInjectedScript();
    if (script === null) throw new Error("script not injected");
    const onloadName = new URL(script.src).searchParams.get("onload") ?? "";
    const api = fakeApi();
    triggerOnload(script, api);
    await expect(promise).resolves.toBe(api);
    expect((window as unknown as Record<string, (() => void) | undefined>)[onloadName]).toBe(
      undefined,
    );
  });
});
