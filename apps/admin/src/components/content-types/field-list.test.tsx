import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { FieldDefinition } from "@plyrs/metamodel";
import { emptyFieldDraft, toFieldDraft, type FieldDraft } from "../../lib/content-type-form";
import { CONTENT_TYPE_LABELS, FIELD_KIND_LABELS } from "../../lib/labels";
import { article } from "../../test-utils/records-harness";
import { FieldList, type FieldListProps } from "./field-list";

const labels = CONTENT_TYPE_LABELS;
const titleDef: FieldDefinition = { key: "title", type: "text", label: "タイトル" };
const bodyDef: FieldDefinition = { key: "body", type: "richtext", label: "本文" };

function setup(props: Partial<FieldListProps> = {}) {
  const onEdit = vi.fn();
  render(
    <FieldList
      drafts={[toFieldDraft(titleDef), toFieldDraft(bodyDef)]}
      original={[titleDef, bodyDef]}
      records={[]}
      titleKey="title"
      editingKey={null}
      isReadOnly={false}
      onEdit={onEdit}
      onReorder={vi.fn()}
      {...props}
    />,
  );
  return onEdit;
}

const row = (name: RegExp) => screen.getByRole("row", { name });

it("行に表示名・API 名・種類・タグ・編集を出し、編集中の行は「編集中」", () => {
  setup({ editingKey: "body" });
  const titleRow = row(/タイトル/);
  expect(within(titleRow).getByText("タイトル")).toBeInTheDocument();
  expect(within(titleRow).getByText("title")).toBeInTheDocument();
  expect(within(titleRow).getByText(FIELD_KIND_LABELS.text.name)).toBeInTheDocument();
  expect(within(titleRow).getByText(labels.tags.title)).toBeInTheDocument();
  expect(within(titleRow).getByRole("button", { name: labels.editor.editField })).toBeEnabled();
  const bodyRow = row(/本文/);
  const editing = within(bodyRow).getByRole("button", { name: labels.editor.editingField });
  expect(editing).toHaveAttribute("aria-expanded", "true");
});

it("必須に変更と種類を変更の行には警告のタグと件数つきの注意が行の下に出る", () => {
  const required: FieldDraft = { ...toFieldDraft(titleDef), required: true };
  const kindChanged: FieldDraft = {
    ...emptyFieldDraft("number", "body", "本文"),
    isNew: false,
  };
  setup({
    drafts: [required, kindChanged],
    // title は 3 件中 2 件が空、body は 3 件とも値あり
    records: [
      article("r1", "A", { input: { title: "A", body: "x" } }),
      article("r2", "", { input: { title: "", body: "x" } }),
      article("r3", "", { input: { body: "x" } }),
    ],
  });
  const titleRow = row(/タイトル/);
  expect(within(titleRow).getByText(labels.tags.requiredChanged)).toBeInTheDocument();
  expect(
    within(titleRow).getByText(labels.warnings.requiredAdded(2), { exact: false }),
  ).toBeInTheDocument();
  const bodyRow = row(/本文/);
  expect(within(bodyRow).getByText(labels.tags.kindChanged)).toBeInTheDocument();
  expect(
    within(bodyRow).getByText(
      `${FIELD_KIND_LABELS.richtext.name}${labels.kindChangeArrow}${FIELD_KIND_LABELS.number.name}`,
    ),
  ).toBeInTheDocument();
  expect(within(bodyRow).getByText(labels.warnings.kindChanged(3))).toBeInTheDocument();
});

it("records が null なら件数なしの文", () => {
  const required: FieldDraft = { ...toFieldDraft(titleDef), required: true };
  setup({ drafts: [required], records: null });
  expect(
    within(row(/タイトル/)).getByText(labels.warnings.requiredAdded(null)),
  ).toBeInTheDocument();
});

it("読み取り専用はつまみが無く「詳細」", async () => {
  const onEdit = setup({ isReadOnly: true });
  expect(screen.queryByRole("button", { name: /を並べ替え/ })).not.toBeInTheDocument();
  const details = screen.getAllByRole("button", { name: labels.editor.viewField });
  expect(details).toHaveLength(2);
  details[0]?.click();
  expect(onEdit).toHaveBeenCalledWith("title", expect.any(HTMLElement));
});
