import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { FIELD_KINDS } from "../../lib/content-type-form";
import { ADD_FIELD_LABELS, FIELD_KIND_LABELS, TERMS } from "../../lib/labels";
import { AddFieldDialog } from "./add-field-dialog";

function renderDialog(
  props: Partial<{
    hasSlug: boolean;
    existing: { key: string; label: string }[];
  }> = {},
) {
  const onAdd = vi.fn();
  render(
    <AddFieldDialog
      isOpen
      onOpenChange={vi.fn()}
      existing={props.existing ?? []}
      hasSlug={props.hasSlug ?? false}
      onAdd={onAdd}
    />,
  );
  return onAdd;
}

const card = (kind: (typeof FIELD_KINDS)[number]["kind"]) =>
  screen.getByRole("button", {
    name: new RegExp(FIELD_KIND_LABELS[kind].name.replace(/[()]/g, "\\$&")),
  });

it("1 段目は 10 種類のカードを基本 / つなぐ / 上級者向けに分け、選ぶまで次へが無効", async () => {
  const user = userEvent.setup();
  renderDialog();
  for (const { kind } of FIELD_KINDS) expect(card(kind)).toBeInTheDocument();
  expect(screen.getByText(ADD_FIELD_LABELS.groups.basic)).toBeInTheDocument();
  expect(screen.getByText(ADD_FIELD_LABELS.groups.link)).toBeInTheDocument();
  expect(screen.getByText(ADD_FIELD_LABELS.groups.advanced)).toBeInTheDocument();
  const next = screen.getByRole("button", { name: ADD_FIELD_LABELS.next });
  expect(next).toBeDisabled();
  await user.click(card("text"));
  expect(card("text")).toHaveAttribute("aria-pressed", "true");
  expect(next).toBeEnabled();
});

it("URL スラッグが既にあればカードが無効で理由が読める", () => {
  renderDialog({ hasSlug: true });
  const slug = card("slug");
  expect(slug).toHaveAttribute("aria-disabled", "true");
  expect(slug).toHaveAccessibleDescription(expect.stringContaining(ADD_FIELD_LABELS.slugTaken));
});

it("日本語の表示名では API 名が空のままで追加が無効、英字なら自動で入る", async () => {
  const user = userEvent.setup();
  const onAdd = renderDialog();
  await user.click(card("text"));
  await user.click(screen.getByRole("button", { name: ADD_FIELD_LABELS.next }));
  const label = screen.getByRole("textbox", { name: new RegExp(ADD_FIELD_LABELS.label) });
  const key = screen.getByRole("textbox", { name: new RegExp(TERMS.fieldKey) });
  await user.type(label, "サブタイトル");
  expect(key).toHaveValue("");
  expect(screen.getByRole("button", { name: ADD_FIELD_LABELS.add })).toBeDisabled();
  expect(screen.getByText("API で使う名前を入力してください")).toBeInTheDocument();
  await user.clear(label);
  await user.type(label, "Sub Title");
  expect(key).toHaveValue("sub_title");
  const add = screen.getByRole("button", { name: ADD_FIELD_LABELS.add });
  expect(add).toBeEnabled();
  await user.click(add);
  expect(onAdd).toHaveBeenCalledWith({ kind: "text", key: "sub_title", label: "Sub Title" });
});

it("手で変えた API 名は表示名を変えても追従しない。重複は表示名つきで出る", async () => {
  const user = userEvent.setup();
  renderDialog({ existing: [{ key: "title", label: "タイトル" }] });
  await user.click(card("text"));
  await user.click(screen.getByRole("button", { name: ADD_FIELD_LABELS.next }));
  const label = screen.getByRole("textbox", { name: new RegExp(ADD_FIELD_LABELS.label) });
  const key = screen.getByRole("textbox", { name: new RegExp(TERMS.fieldKey) });
  await user.type(label, "Abc");
  expect(key).toHaveValue("abc");
  await user.clear(key);
  await user.type(key, "title");
  expect(screen.getByText("「title」は「タイトル」で既に使われています")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: ADD_FIELD_LABELS.add })).toBeDisabled();
  await user.type(label, "def");
  expect(key).toHaveValue("title");
});

it("URL スラッグを選ぶと 2 段目の API 名は slug で固定、表示名の初期値は「URL スラッグ」", async () => {
  const user = userEvent.setup();
  const onAdd = renderDialog();
  await user.click(card("slug"));
  await user.click(screen.getByRole("button", { name: ADD_FIELD_LABELS.next }));
  const key = screen.getByRole("textbox", { name: new RegExp(TERMS.fieldKey) });
  expect(key).toHaveValue("slug");
  expect(key).toBeDisabled();
  expect(screen.getByRole("textbox", { name: new RegExp(ADD_FIELD_LABELS.label) })).toHaveValue(
    FIELD_KIND_LABELS.slug.name,
  );
  await user.click(screen.getByRole("button", { name: ADD_FIELD_LABELS.add }));
  expect(onAdd).toHaveBeenCalledWith({
    kind: "slug",
    key: "slug",
    label: FIELD_KIND_LABELS.slug.name,
  });
});

it("種類を選び直すで 1 段目に戻り、選択は保たれる", async () => {
  const user = userEvent.setup();
  renderDialog();
  await user.click(card("number"));
  await user.click(screen.getByRole("button", { name: ADD_FIELD_LABELS.next }));
  expect(
    screen.getByText(ADD_FIELD_LABELS.step1Done(FIELD_KIND_LABELS.number.name)),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: ADD_FIELD_LABELS.back }));
  expect(card("number")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: ADD_FIELD_LABELS.next })).toBeEnabled();
});
