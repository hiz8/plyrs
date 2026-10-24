import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildMediaRows } from "../../lib/media-list";
import type { ResolvedUsage } from "../../lib/media";
import { ASSET_1, assetRecord } from "../../test-utils/media-harness";
import { DeleteMediaDialog, type DeleteMediaTarget } from "./delete-media-dialog";

const [row] = buildMediaRows([assetRecord(ASSET_1, "one.png")]);
if (row === undefined) throw new Error("row");

function usage(recordId: string, title: string): ResolvedUsage {
  return {
    recordId,
    typeKey: "news",
    typeName: "お知らせ",
    title,
    fieldKey: "hero",
    origin: "relation",
    place: "x",
  };
}

function renderDialog(target: DeleteMediaTarget) {
  return render(
    <DeleteMediaDialog target={target} onConfirm={vi.fn()} onCancel={vi.fn()} isPending={false} />,
  );
}

describe("DeleteMediaDialog", () => {
  it("使用中の 1 件は件数とタイトルの注記を出す", () => {
    renderDialog({
      kind: "one",
      row,
      usage: { status: "ready", entries: [usage("r1", "はじめの記事"), usage("r2", "二つ目")] },
    });
    const dialog = screen.getByRole("alertdialog", { name: "one.png を削除しますか？" });
    expect(within(dialog).getByText("2 件のコンテンツで使われています")).toBeInTheDocument();
    expect(within(dialog).getByText(/はじめの記事、二つ目/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "削除する" })).toBeInTheDocument();
  });
});

describe("DeleteMediaDialog(状態)", () => {
  it("未使用は注記なし", () => {
    renderDialog({ kind: "one", row, usage: { status: "ready", entries: [] } });
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("ファイルは元に戻せません。")).toBeInTheDocument();
    expect(within(dialog).queryByText(/で使われています/)).toBeNull();
  });

  it("確認中の文", () => {
    renderDialog({ kind: "one", row, usage: { status: "pending" } });
    expect(screen.getByText("使用箇所を確認しています…")).toBeInTheDocument();
  });

  it("確認に失敗したときは警告の注記", () => {
    renderDialog({ kind: "one", row, usage: { status: "error" } });
    expect(screen.getByText("使用箇所を確認できませんでした")).toBeInTheDocument();
  });

  it("一括は件数と使用中の件数", () => {
    renderDialog({ kind: "many", ids: ["a", "b", "c"], inUse: 2 });
    const dialog = screen.getByRole("alertdialog", { name: "3 件のファイルを削除しますか？" });
    expect(
      within(dialog).getByText("そのうち 2 件はコンテンツで使われています"),
    ).toBeInTheDocument();
  });

  it("一括で使用中の件数が分からないときは確認できなかった旨の注記", () => {
    renderDialog({ kind: "many", ids: ["a", "b"], inUse: null });
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("使用箇所を確認できませんでした")).toBeInTheDocument();
    expect(within(dialog).queryByText(/そのうち/)).toBeNull();
  });
});
