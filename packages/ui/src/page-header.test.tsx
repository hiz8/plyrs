import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Banner } from "./banner";
import { Button } from "./button";
import { PageHeader } from "./page-header";
import { Skeleton } from "./skeleton";

it("h1 を 1 つだけ置き、補助操作 → 主操作の順に右端へ並べ、バナーはヘッダーの後ろに置く", () => {
  render(
    <PageHeader
      title="お知らせ"
      breadcrumbs={[
        { id: "home", label: "ホーム", href: "/t/acme" },
        { id: "news", label: "お知らせ" },
      ]}
      secondaryActions={<Button variant="secondary">インポート</Button>}
      primaryAction={<Button>お知らせを追加</Button>}
      banner={<Banner tone="warning">サーバーとの接続が切れています。</Banner>}
    />,
  );
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("お知らせ");
  const secondary = screen.getByRole("button", { name: "インポート" });
  const primary = screen.getByRole("button", { name: "お知らせを追加" });
  expect(
    secondary.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const header = screen.getByRole("banner");
  const banner = screen.getByRole("status");
  expect(header.contains(banner)).toBe(false);
  expect(header.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("パンくずと操作は省ける", () => {
  render(<PageHeader title="ホーム" />);
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("title に要素を渡せる(同期前のスケルトン)", () => {
  render(<PageHeader title={<Skeleton width={160} height={24} />} />);
  expect(screen.getByRole("heading", { level: 1 })).not.toHaveAttribute("title");
});

it("meta を見出しの右に出す", () => {
  render(<PageHeader title="お知らせを編集" meta={<span>最終更新 10 分前</span>} />);
  expect(screen.getByText("最終更新 10 分前")).toBeInTheDocument();
});
