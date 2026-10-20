import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CONTENT_TYPE_LABELS } from "../../lib/labels";
import { DeleteTypeDialog } from "./delete-type-dialog";

it("題・本文・オフラインの注記・危険色の「削除する」を出し、初期フォーカスはキャンセル", async () => {
  const labels = CONTENT_TYPE_LABELS.deleteDialog;
  render(
    <DeleteTypeDialog
      target={{ name: "お知らせ" }}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      isPending={false}
    />,
  );
  expect(screen.getByText(labels.title("お知らせ"))).toBeVisible();
  expect(screen.getByText(labels.body)).toBeVisible();
  expect(screen.getByText(labels.offline)).toBeVisible();
  expect(screen.getByRole("button", { name: labels.confirm })).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "キャンセル" })).toHaveFocus());
});
