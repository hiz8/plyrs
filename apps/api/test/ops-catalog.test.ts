import { describe, expect, it, vi } from "vitest";

// M1-1 のレビュー指摘: catalog.ts と read.ts の循環 import。ops/read を先に import しても
// OPERATIONS が初期化できること(TDZ にならないこと)と、宣言(OPERATIONS)と実装(HANDLERS)の
// 名前が一致することを確かめる。

describe("操作カタログの読み込み順", () => {
  it("ops/read を先に import しても OPERATIONS は宣言順(読み取り → 履歴 → 書き込み)で初期化される", async () => {
    vi.resetModules();
    const read = await import("../src/ops/read");
    const history = await import("../src/ops/history");
    const search = await import("../src/ops/search");
    const write = await import("../src/ops/write");
    const assets = await import("../src/ops/assets");
    const catalog = await import("../src/ops/catalog");
    expect(read.READ_OPERATIONS.map((op) => op.name)).toEqual([
      "type_list",
      "type_get",
      "record_list",
      "record_get",
    ]);
    expect(search.SEARCH_OPERATIONS.map((op) => op.name)).toEqual(["record_search"]);
    expect(history.HISTORY_OPERATIONS.map((op) => op.name)).toEqual([
      "record_history",
      "record_compare",
      "record_restore",
    ]);
    expect(write.WRITE_OPERATIONS.map((op) => op.name)).toEqual([
      "record_create",
      "record_update",
      "record_delete",
      "record_publish",
      "record_unpublish",
    ]);
    expect(catalog.OPERATIONS.map((op) => op.name)).toEqual([
      ...read.READ_OPERATIONS.map((op) => op.name),
      ...search.SEARCH_OPERATIONS.map((op) => op.name),
      ...history.HISTORY_OPERATIONS.map((op) => op.name),
      ...write.WRITE_OPERATIONS.map((op) => op.name),
      ...assets.ASSET_OPERATIONS.map((op) => op.name),
    ]);
  });

  it("宣言した全操作に実装(handler)がある(Worker で実行する操作は DO のハンドラを持たない)", async () => {
    vi.resetModules();
    const catalog = await import("../src/ops/catalog");
    const invoke = await import("../src/ops/invoke");
    expect(Object.keys(invoke.HANDLERS).toSorted()).toEqual(
      catalog.OPERATIONS.filter((op) => op.runsIn !== "worker")
        .map((op) => op.name)
        .toSorted(),
    );
  });
});
