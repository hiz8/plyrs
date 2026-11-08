import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CardRow, HomeCard, SummaryLink } from "./home-card";
import { BLOG, NEWS, summary } from "./fixtures";

it("HomeCard は h2 の題で名前が付いた section になる", () => {
  render(
    <HomeCard title="自分の下書き" note="5 件">
      <p>中身</p>
    </HomeCard>,
  );
  expect(screen.getByRole("region", { name: "自分の下書き" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "自分の下書き" })).toBeInTheDocument();
  expect(screen.getByText("5 件")).toBeInTheDocument();
});

it("CardRow は href があればリンクになり、無ければ div", () => {
  const { rerender } = render(<CardRow href="/t/blog/x">行</CardRow>);
  expect(screen.getByRole("link", { name: "行" })).toHaveAttribute("href", "/t/blog/x");
  rerender(<CardRow>行</CardRow>);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByText("行").tagName).toBe("DIV");
});

const hrefOf = (type: { key: string }) => `/t/blog/content/${type.key}?status=draft`;

it("SummaryLink は型が 1 つならリンク 1 つ、複数なら型ごとのリンクを並べる", () => {
  const { rerender } = render(
    <SummaryLink summary={summary([NEWS, 3])} hrefOf={hrefOf} label="下書きをすべて見る" />,
  );
  expect(screen.getByRole("link", { name: "下書きをすべて見る" })).toHaveAttribute(
    "href",
    "/t/blog/content/news?status=draft",
  );
  rerender(
    <SummaryLink
      summary={summary([NEWS, 2], [BLOG, 1])}
      hrefOf={hrefOf}
      label="下書きをすべて見る"
    />,
  );
  expect(screen.queryByRole("link", { name: "下書きをすべて見る" })).not.toBeInTheDocument();
  expect(screen.getByText("下書きをすべて見る")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "お知らせ 2" })).toHaveAttribute(
    "href",
    "/t/blog/content/news?status=draft",
  );
  expect(screen.getByRole("link", { name: "ブログ 1" })).toBeInTheDocument();
});
