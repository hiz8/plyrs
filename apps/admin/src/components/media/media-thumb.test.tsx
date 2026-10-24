import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { mediaRow, MEDIA_ID_A } from "../../test-utils/media-rows";
import { MediaThumb } from "./media-thumb";

const image = mediaRow(MEDIA_ID_A, { filename: "a.png", content_type: "image/png", alt: "夕日" });

const original = window.IntersectionObserver;
afterEach(() => {
  if (original === undefined) Reflect.deleteProperty(window, "IntersectionObserver");
  else window.IntersectionObserver = original;
});

it("画像は IntersectionObserver が無ければ即 resolveUrl を呼び、img を描く", async () => {
  Reflect.deleteProperty(window, "IntersectionObserver");
  const resolveUrl = vi.fn().mockResolvedValue("blob:a");
  render(<MediaThumb row={image} resolveUrl={resolveUrl} size="tile" />);
  const img = await screen.findByRole("img", { name: "夕日" });
  expect(img).toHaveAttribute("src", "blob:a");
  expect(resolveUrl).toHaveBeenCalledWith(MEDIA_ID_A);
});

function stubObserver() {
  const callbacks: IntersectionObserverCallback[] = [];
  const disconnect = vi.fn();
  class FakeObserver {
    constructor(callback: IntersectionObserverCallback) {
      callbacks.push(callback);
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = disconnect;
  }
  window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  return { callbacks, disconnect };
}

it("IntersectionObserver があれば画面に入るまで resolveUrl を呼ばない(eager なら呼ぶ)", async () => {
  const { callbacks, disconnect } = stubObserver();
  const resolveUrl = vi.fn().mockResolvedValue("blob:a");
  const { unmount } = render(<MediaThumb row={image} resolveUrl={resolveUrl} size="tile" />);
  expect(resolveUrl).not.toHaveBeenCalled();
  act(() => {
    callbacks[0]?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
  await waitFor(() => expect(resolveUrl).toHaveBeenCalledWith(MEDIA_ID_A));
  expect(await screen.findByRole("img", { name: "夕日" })).toBeInTheDocument();
  // 一度見えたら観測をやめる
  expect(disconnect).toHaveBeenCalled();
  unmount();

  const eagerResolve = vi.fn().mockResolvedValue("blob:b");
  render(<MediaThumb row={image} resolveUrl={eagerResolve} size="preview" eager />);
  await waitFor(() => expect(eagerResolve).toHaveBeenCalled());
});

it("画像以外は種類のアイコンと拡張子を出す", () => {
  const resolveUrl = vi.fn();
  const { rerender } = render(
    <MediaThumb
      row={mediaRow(MEDIA_ID_A, { filename: "doc.pdf", content_type: "application/pdf" })}
      resolveUrl={resolveUrl}
      size="tile"
    />,
  );
  expect(screen.getByText("PDF")).toBeInTheDocument();
  rerender(
    <MediaThumb
      row={mediaRow(MEDIA_ID_A, { filename: "data.csv", content_type: "text/csv" })}
      resolveUrl={resolveUrl}
      size="xs"
    />,
  );
  expect(screen.getByText("CSV")).toBeInTheDocument();
  expect(resolveUrl).not.toHaveBeenCalled();
});

it("resolveUrl が reject したらアイコンと拡張子を出し、エラーを投げない", async () => {
  Reflect.deleteProperty(window, "IntersectionObserver");
  const resolveUrl = vi.fn().mockRejectedValue(new Error("boom"));
  render(<MediaThumb row={image} resolveUrl={resolveUrl} size="tile" />);
  expect(await screen.findByText("PNG")).toBeInTheDocument();
  expect(screen.queryByRole("img")).toBeNull();
});

it("画像は解決前は空の枠で、拡張子を出さない", () => {
  Reflect.deleteProperty(window, "IntersectionObserver");
  render(<MediaThumb row={image} resolveUrl={() => new Promise(() => undefined)} size="tile" />);
  expect(screen.queryByText("PNG")).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
});
