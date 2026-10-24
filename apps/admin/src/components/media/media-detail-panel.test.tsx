import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MediaRow } from "../../lib/media-list";
import type { ResolvedUsage } from "../../lib/media";
import { assetRecord, ASSET_1, ASSET_2 } from "../../test-utils/media-harness";
import { buildMediaRows } from "../../lib/media-list";
import { MediaDetailPanel, type MediaDetailPanelProps } from "./media-detail-panel";

const copyText = vi.hoisted(() => vi.fn());
vi.mock("../../lib/clipboard", () => ({ copyText }));

function deferred() {
  const state: { resolve: () => void } = { resolve: () => undefined };
  const promise = new Promise<void>((resolve) => {
    state.resolve = resolve;
  });
  return { promise, resolve: () => state.resolve() };
}

const altField = () => screen.getByRole("textbox", { name: "代替テキスト" });

function rowOf(id = ASSET_1, input: Record<string, unknown> = {}): MediaRow {
  const [row] = buildMediaRows([
    assetRecord(id, "one.jpg", {
      input: { content_type: "image/jpeg", size: 1_258_291, width: 1920, height: 1080, ...input },
    }),
  ]);
  if (row === undefined) throw new Error("row");
  return row;
}

const USAGE: ResolvedUsage[] = [
  {
    recordId: "rec1",
    typeKey: "news",
    typeName: "お知らせ",
    title: "秋のキャンペーン",
    fieldKey: "hero",
    origin: "relation",
    place: "アイキャッチ",
  },
  {
    recordId: "rec1",
    typeKey: "news",
    typeName: "お知らせ",
    title: "秋のキャンペーン",
    fieldKey: "body",
    origin: "body",
    place: "本文中",
  },
];

function setup(overrides: Partial<MediaDetailPanelProps> = {}) {
  const props: MediaDetailPanelProps = {
    tenantSlug: "blog",
    tenantId: "t1",
    row: rowOf(),
    isOpen: true,
    notFound: false,
    resolveUrl: async () => null,
    usage: { status: "ready", entries: USAGE },
    publication: {
      status: "ready",
      published: true,
      url: "https://x.test/public/v1/blog/assets/a",
    },
    canWrite: true,
    canDelete: true,
    onSave: vi.fn(async () => undefined),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    returnFocusTo: createRef<HTMLElement>(),
    ...overrides,
  };
  const view = render(<MediaDetailPanel {...props} />);
  return { props, ...view };
}

describe("MediaDetailPanel", () => {
  it("情報・公開中の URL とコピー・使用箇所のリンクを出し、保存は変更があるときだけ有効", async () => {
    const { props } = setup();
    const dialog = screen.getByRole("dialog", { name: "one.jpg" });
    expect(within(dialog).getByText("image/jpeg")).toBeInTheDocument();
    expect(within(dialog).getByText("1.2 MB")).toBeInTheDocument();
    expect(within(dialog).getAllByText("1920 × 1080")).toHaveLength(2); // プレビューのバッジと情報欄
    expect(within(dialog).getByText("公開中")).toBeInTheDocument();
    expect(within(dialog).getByText("https://x.test/public/v1/blog/assets/a")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "コピー" }));
    expect(copyText).toHaveBeenCalledWith("https://x.test/public/v1/blog/assets/a");

    // 同じコンテンツの 2 か所での使用は 2 行になる
    const links = within(dialog).getAllByRole("link", { name: "秋のキャンペーン" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/t/blog/content/news/rec1");
    expect(within(dialog).getByText("お知らせ ・ アイキャッチ")).toBeInTheDocument();
    expect(within(dialog).getByText("お知らせ ・ 本文中")).toBeInTheDocument();

    const save = within(dialog).getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "代替テキスト" }), {
      target: { value: "秋の山" },
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ alt: "秋の山", caption: "" }));
  });

  it("未公開は案内を出し、使用箇所 0 件は文、取得失敗は再試行", () => {
    setup({
      publication: { status: "ready", published: false, url: "u" },
      usage: { status: "ready", entries: [] },
    });
    expect(screen.getByText("未公開")).toBeInTheDocument();
    expect(
      screen.getByText("このファイルを使っているコンテンツを公開すると、一緒に公開されます"),
    ).toBeInTheDocument();
    expect(screen.getByText("まだ使われていません")).toBeInTheDocument();
    expect(screen.queryByText("コピー")).toBeNull();
  });

  it("公開状態と使用箇所の取得失敗はそれぞれ文と再試行を出す", () => {
    const retryPublication = vi.fn();
    const retryUsage = vi.fn();
    setup({
      publication: { status: "error", onRetry: retryPublication },
      usage: { status: "error", onRetry: retryUsage },
    });
    expect(screen.getByText("公開状態を取得できませんでした")).toBeInTheDocument();
    expect(screen.getByText("使用箇所を取得できませんでした")).toBeInTheDocument();
    const retries = screen.getAllByRole("button", { name: "再試行" });
    expect(retries).toHaveLength(2);
    for (const button of retries) fireEvent.click(button);
    expect(retryPublication).toHaveBeenCalledOnce();
    expect(retryUsage).toHaveBeenCalledOnce();
  });

  it("閲覧者は入力が読み取り専用で保存と削除が無い", () => {
    setup({ canWrite: false, canDelete: false });
    expect(screen.getByRole("textbox", { name: "代替テキスト" })).toHaveAttribute("readonly");
    expect(screen.getByRole("textbox", { name: "キャプション" })).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ファイルを削除" })).toBeNull();
  });

  it("row が差し替わっても入力中の値を保ち、id が変わると取り直す", () => {
    const { props, rerender } = setup({ row: rowOf(ASSET_1, { alt: "元" }) });
    expect(altField()).toHaveValue("元");
    fireEvent.change(altField(), { target: { value: "入力中" } });
    // 同期で同じ id の行が差し替わっても入力は消えない
    rerender(<MediaDetailPanel {...props} row={rowOf(ASSET_1, { alt: "元", size: 5 })} />);
    expect(altField()).toHaveValue("入力中");
    rerender(<MediaDetailPanel {...props} row={rowOf(ASSET_2, { alt: "別" })} />);
    expect(altField()).toHaveValue("別");
  });

  it("触っていない欄は同期の変更に追従する", () => {
    const { props, rerender } = setup({ row: rowOf(ASSET_1, { alt: "元", caption: "旧" }) });
    fireEvent.change(altField(), { target: { value: "入力中" } });
    rerender(
      <MediaDetailPanel {...props} row={rowOf(ASSET_1, { alt: "元", caption: "新しい文" })} />,
    );
    expect(altField()).toHaveValue("入力中");
    expect(screen.getByRole("textbox", { name: "キャプション" })).toHaveValue("新しい文");
  });

  it("notFound は見つからない文だけ", () => {
    setup({ row: null, notFound: true });
    expect(
      screen.getByText("ファイルが見つかりません。削除された可能性があります"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("ファイルを削除を押すと onDelete", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "ファイルを削除" }));
    expect(props.onDelete).toHaveBeenCalledOnce();
  });

  it("保存中は入力を保ち保存を押せない", async () => {
    const pending = deferred();
    const onSave = vi.fn(() => pending.promise);
    setup({ onSave });
    fireEvent.change(screen.getByRole("textbox", { name: "キャプション" }), {
      target: { value: "文" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeDisabled());
    expect(screen.getByRole("textbox", { name: "キャプション" })).toHaveValue("文");
    pending.resolve();
  });
});
