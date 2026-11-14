import { ASSET_TYPE_DEFINITION } from "@plyrs/metamodel";
import { SyncEngine } from "@plyrs/sync-client";
import { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { pendingConnect } from "~/test-utils/fake-socket";
import { ASSET_1, ASSET_2, ASSET_3, assetRecord } from "~/test-utils/media-harness";
import { relationDraftKey } from "../lib/record-form-values";
import { AssetRelationPicker } from "./asset-picker";

// メディアを選ぶダイアログのフィルター(RAC の Select)は、ほかのテストと同じく標準の select に差し替える
vi.mock("~/features/media/components/media-filter-select", async () => {
  const mock = await import("~/test-utils/media-filter-select-mock");
  return { MediaFilterSelect: mock.MediaFilterSelectMock };
});

const DANGLING = "018f2b6a-7a0f-7000-8000-000000000e0a";
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

it("既存の選択を外して挿入すると、フィールドの値から消える", async () => {
  const registry = buildRegistry();
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <AssetRelationPicker
      field={{
        key: "gallery",
        type: "relation",
        config: { allowedTypes: ["asset"], cardinality: "many" },
      }}
      value={[
        relationDraftKey({ type: "asset", id: ASSET_1 }),
        relationDraftKey({ type: "asset", id: ASSET_2 }),
        relationDraftKey({ type: "asset", id: DANGLING }),
      ]}
      onChange={onChange}
      error={undefined}
      types={[ASSET_TYPE_DEFINITION]}
      registry={registry}
      assets={{ upload: vi.fn(async () => ({ id: NEW_ID })), resolveUrl: vi.fn(async () => null) }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "メディアを選択" }));
  const dialog = await screen.findByRole("dialog", { name: "メディアを選択" });
  await user.click(within(dialog).getByRole("checkbox", { name: /選択 a\.png/ }));
  await user.click(within(dialog).getByRole("button", { name: "1 件を挿入" }));
  // レコードの無い(dangling な)id は黙って消さず、末尾に保つ
  expect(onChange).toHaveBeenCalledWith([
    relationDraftKey({ type: "asset", id: ASSET_2 }),
    relationDraftKey({ type: "asset", id: DANGLING }),
  ]);
});
