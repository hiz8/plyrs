import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TurnstileApi, TurnstileRenderParams } from "../lib/turnstile";

type RenderMock = Mock<(el: HTMLElement, params: TurnstileRenderParams) => string>;

function fakeApi(): { api: TurnstileApi; render: RenderMock } {
  const renderMock: RenderMock = vi.fn(() => "widget-1");
  const api: TurnstileApi = { render: renderMock, reset: vi.fn(), remove: vi.fn() };
  return { api, render: renderMock };
}

// lib/turnstile.ts の loadTurnstile はモジュールスコープの Promise を使い回す。テストごとに
// window.turnstile を差し替えても前のテストの Promise が残っていると古い偽装が解決値として
// 返ってしまうため、毎回モジュールをリセットしてコンポーネントを動的 import し直す。
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TurnstileWidget", () => {
  it("renders via window.turnstile and forwards the callback token to onToken", async () => {
    const { api, render: renderMock } = fakeApi();
    vi.stubGlobal("turnstile", api);
    const { TurnstileWidget } = await import("./turnstile-widget");
    const onToken = vi.fn();
    render(<TurnstileWidget siteKey="site-1" onToken={onToken} />);

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    const [container, params] = renderMock.mock.calls[0] ?? [];
    expect(container).toBeInstanceOf(HTMLElement);
    expect(params?.sitekey).toBe("site-1");

    params?.callback?.("tok-1");
    expect(onToken).toHaveBeenCalledWith("tok-1");
  });

  it("reports null on expiry and on error, and resets the widget on error", async () => {
    const { api, render: renderMock } = fakeApi();
    vi.stubGlobal("turnstile", api);
    const { TurnstileWidget } = await import("./turnstile-widget");
    const onToken = vi.fn();
    render(<TurnstileWidget siteKey="site-1" onToken={onToken} />);

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    const params = renderMock.mock.calls[0]?.[1];

    params?.["expired-callback"]?.();
    expect(onToken).toHaveBeenLastCalledWith(null);

    params?.["error-callback"]?.();
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(api.reset).toHaveBeenCalledWith("widget-1");
  });

  it("removes the widget on unmount", async () => {
    const { api, render: renderMock } = fakeApi();
    vi.stubGlobal("turnstile", api);
    const { TurnstileWidget } = await import("./turnstile-widget");
    const { unmount } = render(<TurnstileWidget siteKey="site-1" onToken={vi.fn()} />);

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    unmount();
    expect(api.remove).toHaveBeenCalledWith("widget-1");
  });

  it("keeps onToken(null) as the default when the script fails to load", async () => {
    const { TurnstileWidget } = await import("./turnstile-widget");
    const onToken = vi.fn();
    render(<TurnstileWidget siteKey="site-1" onToken={onToken} />);

    const script = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
    );
    if (script === null) throw new Error("script not injected");
    script.dispatchEvent(new Event("error"));

    await waitFor(() => expect(onToken).toHaveBeenCalledWith(null));
  });

  it("calls onLoadError when the script fails to load", async () => {
    const { TurnstileWidget } = await import("./turnstile-widget");
    const onToken = vi.fn();
    const onLoadError = vi.fn();
    render(<TurnstileWidget siteKey="site-1" onToken={onToken} onLoadError={onLoadError} />);

    const script = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
    );
    if (script === null) throw new Error("script not injected");
    script.dispatchEvent(new Event("error"));

    await waitFor(() => expect(onLoadError).toHaveBeenCalledTimes(1));
  });

  it("ignores a load failure that arrives after unmount", async () => {
    const { TurnstileWidget } = await import("./turnstile-widget");
    const onToken = vi.fn();
    const onLoadError = vi.fn();
    const { unmount } = render(
      <TurnstileWidget siteKey="site-1" onToken={onToken} onLoadError={onLoadError} />,
    );

    const script = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
    );
    if (script === null) throw new Error("script not injected");
    unmount();
    script.dispatchEvent(new Event("error"));
    // catch は promise の microtask 経由で走るため、マクロタスク境界まで待って未呼び出しを確認する。
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onToken).not.toHaveBeenCalled();
    expect(onLoadError).not.toHaveBeenCalled();
  });

  it("ignores render callbacks that fire after unmount", async () => {
    const { api, render: renderMock } = fakeApi();
    vi.stubGlobal("turnstile", api);
    const { TurnstileWidget } = await import("./turnstile-widget");
    const onToken = vi.fn();
    const onLoadError = vi.fn();
    const { unmount } = render(
      <TurnstileWidget siteKey="site-1" onToken={onToken} onLoadError={onLoadError} />,
    );

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    const params = renderMock.mock.calls[0]?.[1];
    unmount();
    params?.callback?.("late-token");
    params?.["expired-callback"]?.();
    params?.["error-callback"]?.();

    expect(onToken).not.toHaveBeenCalled();
    expect(onLoadError).not.toHaveBeenCalled();
  });
});
