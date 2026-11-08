import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { GettingStarted, NoTypesNotice } from "./getting-started";

it("3 つの手順と行き先のボタンを出し、押すとコールバックを呼ぶ", async () => {
  const onCreateType = vi.fn();
  const onOpenMedia = vi.fn();
  const onInviteMembers = vi.fn();
  render(
    <GettingStarted
      siteName="テスト"
      onCreateType={onCreateType}
      onOpenMedia={onOpenMedia}
      onInviteMembers={onInviteMembers}
    />,
  );
  expect(screen.getByRole("heading", { level: 2, name: "はじめに" })).toBeInTheDocument();
  expect(screen.getByText(/「テスト」を使い始めるための手順/)).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
  await userEvent.click(screen.getByRole("button", { name: "コンテンツタイプを作成" }));
  expect(onCreateType).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "メディアを開く" }));
  expect(onOpenMedia).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "メンバーを追加" }));
  expect(onInviteMembers).toHaveBeenCalledTimes(1);
});

it("NoTypesNotice は依頼の案内を出し、メールアドレスを含まない", () => {
  const { container } = render(<NoTypesNotice />);
  expect(screen.getByText("コンテンツの種類がまだありません")).toBeInTheDocument();
  expect(screen.getByText(/サイトの管理者に、コンテンツタイプの作成を依頼/)).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/@/);
});
