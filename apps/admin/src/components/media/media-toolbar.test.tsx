import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DEFAULT_MEDIA_QUERY, type MediaQuery } from "../../lib/media-list";
import { MediaToolbar, type MediaToolbarProps } from "./media-toolbar";

vi.mock("./media-filter-select", async () => {
  const mock = await import("../../test-utils/media-filter-select-mock");
  return { MediaFilterSelect: mock.MediaFilterSelectMock };
});

function setup(over: Partial<MediaToolbarProps> = {}) {
  const props: MediaToolbarProps = {
    query: DEFAULT_MEDIA_QUERY,
    onQueryChange: vi.fn(),
    count: 12,
    view: "grid",
    onViewChange: vi.fn(),
    usageError: null,
    ...over,
  };
  render(<MediaToolbar {...props} />);
  return props;
}

it("種類・使用状況・並び順・検索を変えると onQueryChange に新しい query が渡る", async () => {
  const props = setup();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("種類"), "pdf");
  expect(props.onQueryChange).toHaveBeenLastCalledWith({ ...DEFAULT_MEDIA_QUERY, kind: "pdf" });
  await user.selectOptions(screen.getByLabelText("使用状況"), "unused");
  expect(props.onQueryChange).toHaveBeenLastCalledWith({ ...DEFAULT_MEDIA_QUERY, usage: "unused" });
  await user.selectOptions(screen.getByLabelText("並び順"), "name");
  expect(props.onQueryChange).toHaveBeenLastCalledWith({ ...DEFAULT_MEDIA_QUERY, sort: "name" });
  await user.type(screen.getByRole("searchbox"), "a");
  expect(props.onQueryChange).toHaveBeenLastCalledWith({ ...DEFAULT_MEDIA_QUERY, q: "a" });
});

it("絞り込みがあれば件数の横に「絞り込みを解除」、未使用なら件数の文が変わる", async () => {
  const query: MediaQuery = { ...DEFAULT_MEDIA_QUERY, usage: "unused" };
  const props = setup({ query, count: 3 });
  expect(
    screen.getByText("3 件 ・ どのコンテンツからも使われていないファイル"),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "絞り込みを解除" }));
  expect(props.onQueryChange).toHaveBeenCalledWith(DEFAULT_MEDIA_QUERY);
});

it("並び順が name のまま「絞り込みを解除」を押しても sort は維持される", async () => {
  const query: MediaQuery = { ...DEFAULT_MEDIA_QUERY, usage: "unused", q: "a", sort: "name" };
  const props = setup({ query, count: 3 });
  await userEvent.click(screen.getByRole("button", { name: "絞り込みを解除" }));
  expect(props.onQueryChange).toHaveBeenCalledWith({ ...DEFAULT_MEDIA_QUERY, sort: "name" });
});

it("絞り込みが無ければ件数だけで解除ボタンは無い", () => {
  setup();
  expect(screen.getByText("12 件")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "絞り込みを解除" })).toBeNull();
});

it("使用状況の取得失敗は alert と再試行を出す", async () => {
  const onRetry = vi.fn();
  setup({ usageError: { onRetry } });
  expect(screen.getByRole("alert")).toHaveTextContent("使用状況を取得できませんでした");
  await userEvent.click(screen.getByRole("button", { name: "再試行" }));
  expect(onRetry).toHaveBeenCalled();
});

it("表示の切り替えで onViewChange", async () => {
  const props = setup();
  await userEvent.click(screen.getByRole("radio", { name: "リスト" }));
  expect(props.onViewChange).toHaveBeenCalledWith("list");
});
