import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { FieldDefinition } from "@plyrs/metamodel";
import { emptyTypeDraft, toTypeDraft } from "../../lib/content-type-form";
import {
  ADD_FIELD_LABELS,
  CONTENT_TYPE_LABELS,
  FIELD_KIND_LABELS,
  FIELD_PANEL_LABELS,
} from "../../lib/labels";
import type { TenantSync } from "../../lib/sync";
import { TenantSyncProvider } from "../../lib/sync-context";
import { ListColumnsSelectMock } from "../../test-utils/list-columns-select-mock";
import { summary } from "../../test-utils/type-rows";
import { TypeEditor, type TypeEditorProps } from "./type-editor";

vi.mock("./list-columns-select", () => ({ ListColumnsSelect: ListColumnsSelectMock }));

// TenantPageHeader が読む同期の最小スタブ(接続済み = バナー無し)
const fakeSync = {
  getStatus: () => "open",
  getHasSynced: () => true,
  getTypes: () => [],
  subscribe: () => () => {},
  start: vi.fn(),
  stop: vi.fn(),
} as unknown as TenantSync;

const editor = CONTENT_TYPE_LABELS.editor;
const fieldDefs: FieldDefinition[] = [
  { key: "title", type: "text", label: "タイトル" },
  { key: "lead", type: "text", label: "リード" },
];
const saved = summary({ key: "article", name: "記事", fields: fieldDefs });

function setup(props: Partial<TypeEditorProps> = {}) {
  const onSubmit = vi.fn(() => Promise.resolve());
  render(
    <TenantSyncProvider sync={fakeSync}>
      <TypeEditor
        slug="blog"
        mode="edit"
        initial={toTypeDraft(saved)}
        original={fieldDefs}
        typeName="記事"
        existingTypes={[saved]}
        records={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        isPending={false}
        {...props}
      />
    </TenantSyncProvider>,
  );
  return onSubmit;
}

const nameBox = () => screen.getByRole("textbox", { name: new RegExp(`^${editor.name}`) });
const keyBox = () => screen.getByRole("textbox", { name: new RegExp(`^${editor.key}`) });

it("新規は表示名・API 名・フィールドがそろうまで作成が無効で、英字の表示名から API 名が入る", async () => {
  const user = userEvent.setup();
  setup({
    mode: "new",
    initial: emptyTypeDraft(),
    original: [],
    typeName: CONTENT_TYPE_LABELS.createTitle,
    existingTypes: [],
    records: null,
  });
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    CONTENT_TYPE_LABELS.createTitle,
  );
  expect(screen.getByRole("button", { name: editor.create })).toBeDisabled();
  expect(screen.getByText(editor.emptyTitle)).toBeInTheDocument();
  await user.type(nameBox(), "News");
  expect(keyBox()).toHaveValue("news");
  // フィールドが 0 件の間は作成できない
  expect(screen.getByRole("button", { name: editor.create })).toBeDisabled();
});

it("フィールドを追加すると末尾に行が増え、続けてパネルが開く", async () => {
  const user = userEvent.setup();
  setup({
    mode: "new",
    initial: emptyTypeDraft(),
    original: [],
    existingTypes: [],
    records: null,
  });
  await user.type(nameBox(), "News");
  fireEvent.click(screen.getByRole("button", { name: editor.addField }));
  const dialog = await screen.findByRole("dialog", { name: ADD_FIELD_LABELS.title });
  await user.click(
    within(dialog).getByRole("button", {
      name: new RegExp(FIELD_KIND_LABELS.text.name.replace(/[()]/g, "\\$&")),
    }),
  );
  await user.click(within(dialog).getByRole("button", { name: ADD_FIELD_LABELS.next }));
  await user.type(
    within(dialog).getByRole("textbox", { name: new RegExp(`^${ADD_FIELD_LABELS.label}`) }),
    "Title",
  );
  await user.click(within(dialog).getByRole("button", { name: ADD_FIELD_LABELS.add }));
  expect(await screen.findByRole("row", { name: /Title/ })).toBeInTheDocument();
  expect(await screen.findByRole("dialog", { name: "Title" })).toBeInTheDocument();
  const create = screen.getByRole("button", { name: editor.create });
  expect(create).toHaveAttribute("aria-disabled", "true");
  expect(create).toHaveAccessibleDescription(editor.panelOpenReason);
});

it("編集は変更が無いと保存が無効で、表示名を変えると有効になり onSubmit に下書きを渡す", async () => {
  const user = userEvent.setup();
  const onSubmit = setup();
  expect(keyBox()).toBeDisabled();
  const save = screen.getByRole("button", { name: editor.save });
  expect(save).toBeDisabled();
  await user.type(nameBox(), "ニュース");
  expect(save).toBeEnabled();
  await user.click(save);
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ key: "article", name: "記事ニュース" }),
  );
});

it("暗黙のタイトルのパネルを変更せずに適用しても保存は無効のまま", async () => {
  const user = userEvent.setup();
  setup();
  const titleRow = screen.getByRole("row", { name: /タイトル/ });
  await user.click(within(titleRow).getByRole("button", { name: editor.editField }));
  const panel = await screen.findByRole("dialog", { name: "タイトル" });
  await user.click(within(panel).getByRole("button", { name: FIELD_PANEL_LABELS.apply }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "タイトル" })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: editor.save })).toBeDisabled();
  expect(within(titleRow).getByText(CONTENT_TYPE_LABELS.tags.title)).toBeInTheDocument();
});

it("パネルの適用でタイトルに使うが移り、行のタグが変わる", async () => {
  const user = userEvent.setup();
  setup();
  const titleRow = screen.getByRole("row", { name: /タイトル/ });
  const leadRow = screen.getByRole("row", { name: /リード/ });
  expect(within(titleRow).getByText(CONTENT_TYPE_LABELS.tags.title)).toBeInTheDocument();
  await user.click(within(leadRow).getByRole("button", { name: editor.editField }));
  const panel = await screen.findByRole("dialog", { name: "リード" });
  await user.click(within(panel).getByRole("checkbox", { name: FIELD_PANEL_LABELS.titleField }));
  await user.click(within(panel).getByRole("button", { name: FIELD_PANEL_LABELS.apply }));
  await waitFor(() =>
    expect(within(leadRow).getByText(CONTENT_TYPE_LABELS.tags.title)).toBeInTheDocument(),
  );
  expect(within(titleRow).queryByText(CONTENT_TYPE_LABELS.tags.title)).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "リード" })).not.toBeInTheDocument();
});

it("読み取り専用は保存・追加・列の変更が無く、行の詳細でパネルが読み取り専用で開く", async () => {
  const user = userEvent.setup();
  setup({ mode: "view" });
  expect(screen.queryByRole("button", { name: editor.save })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: editor.cancel })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: editor.addField })).not.toBeInTheDocument();
  expect(screen.getByText(editor.viewMeta)).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: editor.addColumn })).toBeDisabled();
  const leadRow = screen.getByRole("row", { name: /リード/ });
  await user.click(within(leadRow).getByRole("button", { name: editor.viewField }));
  const panel = await screen.findByRole("dialog", { name: "リード" });
  expect(
    within(panel).queryByRole("button", { name: FIELD_PANEL_LABELS.apply }),
  ).not.toBeInTheDocument();
  expect(
    within(panel).getAllByRole("button", { name: FIELD_PANEL_LABELS.close }).length,
  ).toBeGreaterThan(0);
});

it("API 名の重複は型名つきで出る", async () => {
  const user = userEvent.setup();
  setup({
    mode: "new",
    initial: emptyTypeDraft(),
    original: [],
    existingTypes: [summary({ key: "asset", name: "アセット", source: "system" })],
    records: null,
  });
  await user.type(keyBox(), "asset");
  expect(
    screen.getByText(CONTENT_TYPE_LABELS.keyErrors.duplicate("asset", "アセット")),
  ).toBeInTheDocument();
});

async function addSelectField(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.click(screen.getByRole("button", { name: editor.addField }));
  const dialog = await screen.findByRole("dialog", { name: ADD_FIELD_LABELS.title });
  await user.click(
    within(dialog).getByRole("button", {
      name: new RegExp(FIELD_KIND_LABELS.select.name.replace(/[()]/g, "\\$&")),
    }),
  );
  await user.click(within(dialog).getByRole("button", { name: ADD_FIELD_LABELS.next }));
  await user.type(
    within(dialog).getByRole("textbox", { name: new RegExp(`^${ADD_FIELD_LABELS.label}`) }),
    "Color",
  );
  await user.click(within(dialog).getByRole("button", { name: ADD_FIELD_LABELS.add }));
  return screen.findByRole("dialog", { name: "Color" });
}

it("選択肢のフィールドを追加してパネルをキャンセルすると、行に未完了が出て保存が無効のまま", async () => {
  const user = userEvent.setup();
  setup();
  const panel = await addSelectField(user);
  await user.click(within(panel).getByRole("button", { name: FIELD_PANEL_LABELS.cancel }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Color" })).toBeNull());
  const row = screen.getByRole("row", { name: /Color/ });
  expect(within(row).getByText(CONTENT_TYPE_LABELS.tags.incomplete)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: editor.save })).toBeDisabled();
});

it("追加の後にパネルを閉じると「フィールドを追加」にフォーカスが戻る", async () => {
  const user = userEvent.setup();
  setup();
  const panel = await addSelectField(user);
  await user.click(within(panel).getByRole("button", { name: FIELD_PANEL_LABELS.cancel }));
  await waitFor(() => expect(screen.getByRole("button", { name: editor.addField })).toHaveFocus());
});

it("表示名を入力してから消すと必須のエラーが出る(初期の空では出ない)", async () => {
  const user = userEvent.setup();
  setup();
  expect(screen.queryByText(editor.nameRequired)).not.toBeInTheDocument();
  await user.clear(nameBox());
  expect(screen.getByText(editor.nameRequired)).toBeInTheDocument();
});
