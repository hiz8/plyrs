import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { publishBoxView, type PublishBoxInput } from "../lib/publish-box";
import { PublishBar, PublishBox } from "./publish-box";

const base: PublishBoxInput = {
  isNew: false,
  isAsset: false,
  publication: { published: false },
  recordVersion: 3,
  dirty: false,
  connected: true,
  canWrite: true,
  canPublish: true,
  canDelete: true,
  phase: "idle",
};
const published = (sourceVersion: number) =>
  ({
    published: true,
    publishedAt: "2026-10-17T01:00:00Z",
    publishedBy: "u1",
    sourceVersion,
  }) as const;

function setup(input: Partial<PublishBoxInput>) {
  const handlers = {
    onPrimary: vi.fn(),
    onSecondary: vi.fn(),
    onStatusChange: vi.fn(),
    onUnpublish: vi.fn(),
    onDelete: vi.fn(),
  };
  const view = publishBoxView({ ...base, ...input });
  render(<PublishBox view={view} status="draft" {...handlers} />);
  return handlers;
}

it("公開中・未反映ありは「更新」と「公開せずに保存」を出し、押すと onPrimary / onSecondary", async () => {
  const user = userEvent.setup();
  const h = setup({ publication: published(2), recordVersion: 3 });
  const region = screen.getByRole("region", { name: "公開" });
  expect(within(region).getByText("未反映の変更があります")).toBeTruthy();
  await user.click(within(region).getByRole("button", { name: "更新" }));
  await user.click(within(region).getByRole("button", { name: "公開せずに保存" }));
  expect(h.onPrimary).toHaveBeenCalledTimes(1);
  expect(h.onSecondary).toHaveBeenCalledTimes(1);
});

it("切断中の「公開」はフォーカスでき aria-disabled で、ツールチップに理由が出る", async () => {
  const user = userEvent.setup();
  const h = setup({ connected: false });
  const button = screen.getByRole("button", { name: "公開" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  await user.hover(button);
  expect(await screen.findByText("接続が切れているため公開できません")).toBeTruthy();
  await user.click(button);
  expect(h.onPrimary).not.toHaveBeenCalled();
});

it("閲覧者はボタン・リンク無しで状態とステータスの文字だけ", () => {
  setup({ canWrite: false, canPublish: false, canDelete: false });
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("下書き")).toBeTruthy();
});

it("ステータスの選択は onStatusChange に値を渡す", async () => {
  const user = userEvent.setup();
  const h = setup({});
  await user.click(screen.getByRole("button", { name: /ステータス/ }));
  await user.click(await screen.findByRole("option", { name: "レビュー中" }));
  expect(h.onStatusChange).toHaveBeenCalledWith("in_review");
});

it("asset は「保存」と「削除」だけで公開状態とステータスを出さない", () => {
  setup({ isAsset: true, publication: undefined, dirty: true });
  expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "削除" })).toBeTruthy();
  expect(screen.queryByText("状態")).toBeNull();
  expect(screen.queryByText("ステータス")).toBeNull();
});

it("PublishBar は閲覧者では何も描かず、書き込み可なら操作の領域にボタンを出す", () => {
  const noop = vi.fn();
  const { container, rerender } = render(
    <PublishBar
      view={publishBoxView({ ...base, canWrite: false })}
      onPrimary={noop}
      onSecondary={noop}
    />,
  );
  expect(container.innerHTML).toBe("");
  rerender(
    <PublishBar
      view={publishBoxView({ ...base, dirty: true })}
      onPrimary={noop}
      onSecondary={noop}
    />,
  );
  const region = screen.getByRole("region", { name: "公開の操作" });
  expect(within(region).getByRole("button", { name: "公開" })).toBeTruthy();
  expect(within(region).getByText("未保存の変更があります")).toBeTruthy();
});
