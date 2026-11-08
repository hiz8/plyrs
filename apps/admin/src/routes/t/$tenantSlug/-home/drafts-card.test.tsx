import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DraftsCard } from "./drafts-card";
import { BLOG, NEWS, homeRecord, summary } from "./fixtures";

it("自分の下書きを行に出し、フッターの「下書きをすべて見る」はその型の下書き一覧へ", () => {
  render(
    <DraftsCard
      slug="blog"
      state={{
        kind: "ready",
        drafts: [homeRecord("r1", NEWS, "春のお知らせ")],
        summary: summary([NEWS, 4]),
      }}
    />,
  );
  expect(screen.getByRole("link", { name: /春のお知らせ/ })).toHaveAttribute(
    "href",
    "/t/blog/content/news/r1",
  );
  expect(screen.getByText("お知らせ")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "下書きをすべて見る" })).toHaveAttribute(
    "href",
    "/t/blog/content/news?status=draft",
  );
});

it("複数の型にまたがるなら型ごとのリンクになる", () => {
  render(
    <DraftsCard
      slug="blog"
      state={{
        kind: "ready",
        drafts: [homeRecord("r1", NEWS, "a")],
        summary: summary([NEWS, 2], [BLOG, 1]),
      }}
    />,
  );
  expect(screen.getByRole("link", { name: "ブログ 1" })).toHaveAttribute(
    "href",
    "/t/blog/content/blog?status=draft",
  );
});

it("0 件なら「下書きはありません」と案内を出す", () => {
  render(<DraftsCard slug="blog" state={{ kind: "ready", drafts: [], summary: summary() }} />);
  expect(screen.getByText("下書きはありません")).toBeInTheDocument();
  expect(screen.getByText("上の「新規追加」から書き始められます")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("error なら alert と再試行を出し、再試行で onRetry を呼ぶ", async () => {
  const onRetry = vi.fn();
  render(
    <DraftsCard
      slug="blog"
      state={{ kind: "error", message: "下書きを表示できませんでした", onRetry }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("下書きを表示できませんでした");
  await userEvent.click(screen.getByRole("button", { name: "再試行" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
