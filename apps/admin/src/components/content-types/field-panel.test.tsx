import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { expect, it, vi } from "vitest";
import { emptyFieldDraft, type FieldDraft } from "../../lib/content-type-form";
import { FIELD_KIND_LABELS, FIELD_PANEL_LABELS, TERMS } from "../../lib/labels";
import { FieldPanel, type FieldPanelProps } from "./field-panel";

const P = FIELD_PANEL_LABELS;

function setup(draft: FieldDraft, props: Partial<FieldPanelProps> = {}) {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  const onDelete = vi.fn();
  render(
    <FieldPanel
      draft={draft}
      others={[]}
      typeOptions={[
        { key: "news", name: "お知らせ" },
        { key: "event", name: "イベント" },
      ]}
      isTitle={false}
      isReadOnly={false}
      returnFocusTo={createRef<HTMLElement>()}
      onApply={onApply}
      onCancel={onCancel}
      onDelete={onDelete}
      {...props}
    />,
  );
  return { onApply, onCancel, onDelete };
}

const saved = (kind: Parameters<typeof emptyFieldDraft>[0], key: string, label: string) => ({
  ...emptyFieldDraft(kind, key, label),
  isNew: false,
});

const labelBox = () => screen.getByRole("textbox", { name: new RegExp(`^${P.label}`) });

it("テキストの設定項目を言い換えた文言で出し、適用で下書きを返す", async () => {
  const user = userEvent.setup();
  const { onApply } = setup(saved("text", "title", "タイトル"));
  expect(screen.getByRole("dialog", { name: "タイトル" })).toBeInTheDocument();
  expect(screen.getByText(P.subtitle(FIELD_KIND_LABELS.text.name))).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: P.titleField })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: P.indexed })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: P.unique })).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: P.required }));
  await user.type(screen.getByRole("textbox", { name: P.maxLength }), "200");
  await user.click(screen.getByRole("button", { name: P.apply }));
  expect(onApply).toHaveBeenCalledWith(
    expect.objectContaining({ key: "title", required: true, maxLength: "200" }),
    { isTitle: false },
  );
});

it("保存済みの API 名は変更できず、未保存なら表示名に追従して重複を検証する", () => {
  const first = setup(saved("text", "title", "タイトル"));
  expect(screen.getByRole("textbox", { name: TERMS.fieldKey })).toBeDisabled();
  expect(screen.getByText(P.keyHelpSaved)).toBeInTheDocument();
  expect(first.onApply).not.toHaveBeenCalled();
});

it("未保存の API 名は表示名に追従し、重複すると適用できない", async () => {
  const user = userEvent.setup();
  const { onApply } = setup(emptyFieldDraft("text", "", ""), {
    others: [{ key: "price", label: "価格" }],
  });
  await user.type(labelBox(), "price");
  expect(screen.getByRole("textbox", { name: TERMS.fieldKey })).toHaveValue("price");
  await user.click(screen.getByRole("button", { name: P.apply }));
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getByText(/価格/)).toBeInTheDocument();
});

it("API 名が slug でなければ種類に URL スラッグが無い", async () => {
  const user = userEvent.setup();
  setup(saved("text", "title", "タイトル"));
  await user.click(screen.getByRole("button", { name: new RegExp(P.kind) }));
  await screen.findByRole("option", { name: FIELD_KIND_LABELS.number.name });
  expect(screen.queryByRole("option", { name: FIELD_KIND_LABELS.slug.name })).toBeNull();
});

it("API 名が slug なら種類に URL スラッグが有る", async () => {
  const user = userEvent.setup();
  setup(saved("text", "slug", "スラッグ"));
  await user.click(screen.getByRole("button", { name: new RegExp(P.kind) }));
  expect(
    await screen.findByRole("option", { name: FIELD_KIND_LABELS.slug.name }),
  ).toBeInTheDocument();
});

it("種類を数値に変えると設定が既定に戻り、副題が変わる", async () => {
  const user = userEvent.setup();
  setup({ ...saved("text", "title", "タイトル"), maxLength: "50" });
  await user.click(screen.getByRole("button", { name: new RegExp(P.kind) }));
  await user.click(await screen.findByRole("option", { name: FIELD_KIND_LABELS.number.name }));
  expect(screen.getByText(P.subtitle(FIELD_KIND_LABELS.number.name))).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: P.integer })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: P.maxLength })).toBeNull();
});

it("選択肢は表で編集し、値が空や重複なら適用できない", async () => {
  const user = userEvent.setup();
  const { onApply } = setup({
    ...saved("select", "color", "色"),
    options: [{ value: "red", label: "赤" }],
  });
  await user.click(screen.getByRole("button", { name: P.addOption }));
  expect(screen.getAllByRole("textbox", { name: new RegExp(P.optionValue) })).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: P.apply }));
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getByText(P.optionValueEmpty)).toBeInTheDocument();
  const second = screen.getAllByRole("textbox", { name: new RegExp(P.optionValue) })[1]!;
  await user.type(second, "red");
  await user.click(screen.getByRole("button", { name: P.apply }));
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getByText(P.optionValueDuplicate("red"))).toBeInTheDocument();
  await user.clear(second);
  await user.type(second, "blue");
  await user.click(screen.getByRole("button", { name: P.apply }));
  expect(onApply).toHaveBeenCalledOnce();
});

it("参照は型の候補・件数・並び順を保持を出し、型を 1 つも選ばないと適用できない", async () => {
  const user = userEvent.setup();
  const { onApply } = setup(saved("reference", "related", "関連"));
  const group = screen.getByRole("group", { name: P.allowedTypes });
  expect(within(group).getByRole("checkbox", { name: "お知らせ" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: P.many })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: P.ordered })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: P.apply }));
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getByText(P.allowedTypesRequired)).toBeInTheDocument();
  await user.click(within(group).getByRole("checkbox", { name: "お知らせ" }));
  await user.click(screen.getByRole("button", { name: P.apply }));
  expect(onApply).toHaveBeenCalledOnce();
});

it("読み取り専用は入力が isReadOnly で、下部は閉じるだけ", () => {
  setup(saved("text", "title", "タイトル"), { isReadOnly: true });
  expect(labelBox()).toHaveAttribute("readonly");
  expect(screen.queryByRole("button", { name: P.apply })).toBeNull();
  expect(screen.queryByRole("button", { name: P.cancel })).toBeNull();
  expect(screen.queryByRole("button", { name: P.deleteField })).toBeNull();
  expect(screen.getAllByRole("button", { name: P.close }).length).toBeGreaterThan(0);
});

it("このフィールドを削除で onDelete を呼ぶ", async () => {
  const user = userEvent.setup();
  const { onDelete } = setup(saved("text", "title", "タイトル"));
  await user.click(screen.getByRole("button", { name: P.deleteField }));
  expect(onDelete).toHaveBeenCalledOnce();
});

it("タイトルに使うを on にして適用すると isTitle: true を返す", async () => {
  const user = userEvent.setup();
  const { onApply } = setup(saved("text", "title", "タイトル"));
  await user.click(screen.getByRole("checkbox", { name: P.titleField }));
  await user.click(screen.getByRole("button", { name: P.apply }));
  expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ key: "title" }), {
    isTitle: true,
  });
});

it("タイトルのテキストを数値に変えて適用すると isTitle: false を返す", async () => {
  const user = userEvent.setup();
  const { onApply } = setup(saved("text", "title", "タイトル"), { isTitle: true });
  expect(screen.getByRole("checkbox", { name: P.titleField })).toBeChecked();
  await user.click(screen.getByRole("button", { name: new RegExp(P.kind) }));
  await user.click(await screen.findByRole("option", { name: FIELD_KIND_LABELS.number.name }));
  await user.click(screen.getByRole("button", { name: P.apply }));
  expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ kind: "number" }), {
    isTitle: false,
  });
});

it("draft を別の key に差し替えるとローカルを取り直し、同じ内容の再描画では巻き戻さない", async () => {
  const user = userEvent.setup();
  const props = {
    others: [],
    typeOptions: [],
    isReadOnly: false,
    returnFocusTo: createRef<HTMLElement>(),
    onApply: vi.fn(),
    onCancel: vi.fn(),
    onDelete: vi.fn(),
  };
  const { rerender } = render(
    <FieldPanel {...props} draft={saved("text", "title", "タイトル")} isTitle={false} />,
  );
  await user.type(screen.getByRole("textbox", { name: P.maxLength }), "30");
  rerender(<FieldPanel {...props} draft={saved("text", "title", "タイトル")} isTitle={false} />);
  expect(screen.getByRole("textbox", { name: P.maxLength })).toHaveValue("30");
  rerender(<FieldPanel {...props} draft={saved("text", "other", "別")} isTitle />);
  expect(screen.getByRole("textbox", { name: P.maxLength })).toHaveValue("");
  expect(screen.getByRole("checkbox", { name: P.titleField })).toBeChecked();
});
