import { ASSET_TYPE_DEFINITION } from "@plyrs/metamodel";
import { SyncEngine } from "@plyrs/sync-client";
import { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { AssetServices } from "../../lib/asset-services";
import type { MediaKind } from "../../lib/media-list";
import { ASSET_1, ASSET_2, ASSET_3, assetRecord } from "../../test-utils/media-harness";
import { pendingConnect } from "../../test-utils/fake-socket";
import { MediaPickerDialog } from "./media-picker-dialog";

vi.mock("./media-filter-select", async () => {
  const mock = await import("../../test-utils/media-filter-select-mock");
  return { MediaFilterSelect: mock.MediaFilterSelectMock };
});

const NEW_ID = "018f2b6a-7a0f-7000-8000-000000000e09";

function buildRegistry() {
  const registry = new CollectionRegistry(new SyncEngine({ connect: pendingConnect }));
  registry.sync([ASSET_TYPE_DEFINITION]);
  registry.markReady();
  registry.applyStoreChange({ kind: "upsert", record: assetRecord(ASSET_1, "a.png") });
  registry.applyStoreChange({ kind: "upsert", record: assetRecord(ASSET_2, "b.png") });
  registry.applyStoreChange({
    kind: "upsert",
    record: assetRecord(ASSET_3, "c.pdf", { input: { content_type: "application/pdf" } }),
  });
  return registry;
}

function setup(
  over: {
    selection?: "one" | "many";
    defaultKind?: MediaKind | "all";
    upload?: AssetServices["upload"];
  } = {},
) {
  const registry = buildRegistry();
  const collection = registry.get("asset");
  if (collection === undefined) throw new Error("asset collection");
  // 実機では ack で解決する。ここでは永続化の完了だけを模す
  const update = vi
    .spyOn(collection, "update")
    .mockImplementation(
      () =>
        ({ isPersisted: { promise: Promise.resolve() } }) as unknown as ReturnType<
          typeof collection.update
        >,
    );
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const assets: AssetServices = {
    upload: over.upload ?? vi.fn(async () => ({ id: NEW_ID })),
    resolveUrl: vi.fn(async () => null),
  };
  render(
    <MediaPickerDialog
      registry={registry}
      types={[ASSET_TYPE_DEFINITION]}
      assets={assets}
      fieldName="hero"
      selection={over.selection ?? "many"}
      defaultKind={over.defaultKind ?? "all"}
      onSelect={onSelect}
      onClose={onClose}
    />,
  );
  return { registry, update, onSelect, onClose };
}

const grid = () => screen.getByRole("grid", { name: "ファイル" });

it("複数は選んだ順に番号が付き、選択中欄に代替テキストの入力欄が並び、挿入で順に返す", async () => {
  const { update, onSelect } = setup();
  const user = userEvent.setup();
  await user.click(screen.getByRole("checkbox", { name: /選択 b\.png/ }));
  await user.click(screen.getByRole("checkbox", { name: /選択 a\.png/ }));
  const tiles = within(grid());
  expect(tiles.getByText("1")).toBeInTheDocument();
  expect(tiles.getByText("2")).toBeInTheDocument();

  const region = within(screen.getByRole("region", { name: "選択中のファイル" }));
  const fields = region.getAllByRole("textbox", { name: "代替テキスト" });
  expect(fields).toHaveLength(2);
  const first = fields[0];
  if (first === undefined) throw new Error("alt field");
  await user.type(first, "Bの説明");

  await user.click(screen.getByRole("button", { name: "2 件を挿入" }));
  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  expect(onSelect).toHaveBeenCalledWith([
    { id: ASSET_2, label: "b.png", alt: "Bの説明" },
    { id: ASSET_1, label: "a.png", alt: "" },
  ]);
  // 変えた b だけを書く
  expect(update).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0]?.[0]).toBe(ASSET_2);
});

it("1 件は置き換わり、ボタンは「このファイルを使う」で、選ぶまで押せない", async () => {
  const { onSelect } = setup({ selection: "one" });
  const user = userEvent.setup();
  const use = screen.getByRole("button", { name: "このファイルを使う" });
  expect(use).toBeDisabled();
  await user.click(within(grid()).getByText("b.png"));
  await user.click(within(grid()).getByText("a.png"));
  expect(use).toBeEnabled();
  expect(screen.getByText("選択中 1 件")).toBeInTheDocument();
  await user.click(use);
  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  expect(onSelect).toHaveBeenCalledWith([{ id: ASSET_1, label: "a.png", alt: "" }]);
});

it("種類の既定が image なら PDF が出ず、検索で絞れる", async () => {
  setup({ defaultKind: "image" });
  const user = userEvent.setup();
  expect(within(grid()).queryByText("c.pdf")).not.toBeInTheDocument();
  expect(within(grid()).getByText("a.png")).toBeInTheDocument();
  await user.type(screen.getByRole("searchbox", { name: "ファイル名・代替テキストで検索" }), "b");
  expect(within(grid()).queryByText("a.png")).not.toBeInTheDocument();
  expect(within(grid()).getByText("b.png")).toBeInTheDocument();
});

it("アップロードが完了すると選択に加わり、印が付き、代替テキストにフォーカスが移る", async () => {
  const state: { resolve: (value: { id: string }) => void } = { resolve: () => undefined };
  const upload = vi.fn(
    () =>
      new Promise<{ id: string }>((resolve) => {
        state.resolve = resolve;
      }),
  );
  const { registry } = setup({ selection: "one", upload });
  const user = userEvent.setup();
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("file input");
  await user.upload(input, new File(["x"], "new.png", { type: "image/png" }));
  await act(async () => state.resolve({ id: NEW_ID }));

  // レコードが届くまでは仮の項目
  const region = within(screen.getByRole("region", { name: "選択中のファイル" }));
  expect(await region.findByText("new.png")).toBeInTheDocument();
  expect(region.getByText(/たった今アップロード/)).toBeInTheDocument();
  expect(region.queryByRole("textbox", { name: "代替テキスト" })).not.toBeInTheDocument();

  act(() => {
    registry.applyStoreChange({
      kind: "upsert",
      record: assetRecord(NEW_ID, "new.png", { input: { size: 1 } }),
    });
  });
  const alt = await region.findByRole("textbox", { name: "代替テキスト" });
  await waitFor(() => expect(alt).toHaveFocus());
  expect(within(grid()).getByText("アップロード完了")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "このファイルを使う" })).toBeEnabled();
});

it("変えた代替テキストは挿入時に asset レコードへ書き、変えなければ書かない", async () => {
  const { update, onSelect } = setup({ selection: "one" });
  const user = userEvent.setup();
  await user.click(within(grid()).getByText("a.png"));
  const alt = within(screen.getByRole("region", { name: "選択中のファイル" })).getByRole(
    "textbox",
    { name: "代替テキスト" },
  );
  await user.type(alt, "山");
  await user.click(screen.getByRole("button", { name: "このファイルを使う" }));
  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0]?.[0]).toBe(ASSET_1);
  expect(onSelect).toHaveBeenCalledWith([{ id: ASSET_1, label: "a.png", alt: "山" }]);
});
