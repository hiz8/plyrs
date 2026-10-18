import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Banner } from "./banner";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";

describe("Banner", () => {
  it("警告は status、エラーは alert で読み上げ、操作を添えられる", () => {
    render(
      <>
        <Banner
          tone="warning"
          action={
            <Button size="sm" variant="secondary">
              今すぐ再接続
            </Button>
          }
        >
          サーバーとの接続が切れています。
        </Banner>
        <Banner tone="danger">このサイトのメンバーから外されました。</Banner>
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("サーバーとの接続が切れています。");
    expect(screen.getByRole("button", { name: "今すぐ再接続" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("メンバーから外されました");
  });
});

describe("EmptyState", () => {
  it("題・説明・次の行動を出す。題は見出しにしない(ページの h1 と競合させない)", () => {
    render(
      <EmptyState
        icon={Inbox}
        title="イベントはまだありません"
        description="最初のイベントを追加しましょう。"
        action={<Button>イベントを追加</Button>}
      />,
    );
    expect(screen.getByText("イベントはまだありません")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "イベントを追加" })).toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("読み上げない", () => {
    const { container } = render(<Skeleton width={64} height={22} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
