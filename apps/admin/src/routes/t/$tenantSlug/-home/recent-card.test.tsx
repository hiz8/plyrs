import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { BLOG, NEWS, homeRecord } from "./fixtures";
import { RecentCard } from "./recent-card";

it("更新日時の新しい順に型名・ステータス・相対時刻を出し、アーカイブは取り消し線", () => {
  render(
    <RecentCard
      slug="blog"
      rows={[
        homeRecord("r1", NEWS, "春のお知らせ", { status: "in_review" }),
        homeRecord("r2", BLOG, "古い記事", { status: "archived" }),
      ]}
    />,
  );
  expect(screen.getByRole("link", { name: "春のお知らせ" })).toHaveAttribute(
    "href",
    "/t/blog/content/news/r1",
  );
  expect(screen.getByRole("link", { name: "古い記事" })).toHaveAttribute(
    "href",
    "/t/blog/content/blog/r2",
  );
  expect(screen.getByText("レビュー中")).toBeInTheDocument();
  expect(screen.getByText("ブログ")).toBeInTheDocument();
  expect(screen.getByText("アーカイブ")).toBeInTheDocument();
  expect(document.querySelectorAll("time")).toHaveLength(2);
});

it("0 件なら「まだ更新はありません」", () => {
  render(<RecentCard slug="blog" rows={[]} />);
  expect(screen.getByText("まだ更新はありません")).toBeInTheDocument();
});
