import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { BLOG, NEWS, summary } from "./fixtures";
import { ReviewCard } from "./review-card";

const none = summary();

it("レビュー中・公開準備完了・未反映の行を件数付きで出し、1 つの型なら行が一覧へのリンク", () => {
  render(
    <ReviewCard
      slug="blog"
      inReview={summary([NEWS, 2])}
      ready={summary([NEWS, 1])}
      changed={{ kind: "ready", summary: summary([NEWS, 3]) }}
    />,
  );
  const review = screen.getByRole("link", { name: /レビュー中/ });
  expect(review).toHaveAttribute("href", "/t/blog/content/news?status=in_review");
  expect(review).toHaveAccessibleName("レビュー中 公開前に確認が必要なもの 2 件");
  expect(screen.getByRole("link", { name: /公開準備完了/ })).toHaveAttribute(
    "href",
    "/t/blog/content/news?status=ready",
  );
  expect(screen.getByRole("link", { name: /未反映の変更あり/ })).toHaveAttribute(
    "href",
    "/t/blog/content/news?tab=unpublished-changes",
  );
});

it("0 件の行は出さない", () => {
  render(
    <ReviewCard
      slug="blog"
      inReview={none}
      ready={summary([NEWS, 1])}
      changed={{ kind: "ready", summary: none }}
    />,
  );
  expect(screen.queryByRole("link", { name: /レビュー中/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /公開準備完了/ })).toBeInTheDocument();
});

it("複数の型にまたがる行はリンクにせず、型ごとの内訳リンクを添える", () => {
  render(
    <ReviewCard
      slug="blog"
      inReview={summary([NEWS, 2], [BLOG, 1])}
      ready={none}
      changed={{ kind: "ready", summary: none }}
    />,
  );
  expect(screen.queryByRole("link", { name: /レビュー中/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "お知らせ 2" })).toHaveAttribute(
    "href",
    "/t/blog/content/news?status=in_review",
  );
  expect(screen.getByRole("link", { name: "ブログ 1" })).toBeInTheDocument();
});

it("すべて 0 件なら「確認待ちのコンテンツはありません」", () => {
  render(
    <ReviewCard
      slug="blog"
      inReview={none}
      ready={none}
      changed={{ kind: "ready", summary: none }}
    />,
  );
  expect(screen.getByText("確認待ちのコンテンツはありません")).toBeInTheDocument();
});

it("未反映の取得に失敗した行だけが alert と再試行になる", async () => {
  const onRetry = vi.fn();
  render(
    <ReviewCard
      slug="blog"
      inReview={summary([NEWS, 2])}
      ready={none}
      changed={{ kind: "error", onRetry }}
    />,
  );
  expect(screen.getByRole("link", { name: /レビュー中/ })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("未反映の変更を確認できませんでした");
  await userEvent.click(screen.getByRole("button", { name: "再試行" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
