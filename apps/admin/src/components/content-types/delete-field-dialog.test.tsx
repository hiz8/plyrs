import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FIELD_PANEL_LABELS } from "../../lib/labels";
import { DeleteFieldDialog } from "./delete-field-dialog";

it("題・本文(API 名入り)・公開 API の注記・危険色の「削除する」、初期フォーカスはキャンセル", async () => {
  const labels = FIELD_PANEL_LABELS.deleteDialog;
  render(
    <DeleteFieldDialog
      target={{ label: "サブタイトル", key: "subtitle" }}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText(labels.title("サブタイトル"))).toBeVisible();
  expect(screen.getByText(labels.body("subtitle"))).toBeVisible();
  expect(screen.getByText(labels.publicNote)).toBeVisible();
  expect(screen.getByRole("button", { name: labels.confirm })).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "キャンセル" })).toHaveFocus());
});
