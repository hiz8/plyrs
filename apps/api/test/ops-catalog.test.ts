import { describe, expect, it, vi } from "vitest";

// M1-1 のレビュー指摘: catalog.ts と read.ts の循環 import。ops/read を先に import しても
// OPERATIONS が初期化できること(TDZ にならないこと)と、宣言(OPERATIONS)と実装(HANDLERS)の
// 名前が一致することを確かめる。

describe("操作カタログの読み込み順", () => {
  it("ops/read を先に import しても OPERATIONS は 4 操作で初期化される", async () => {
    vi.resetModules();
    const read = await import("../src/ops/read");
    const catalog = await import("../src/ops/catalog");
    expect(read.READ_OPERATIONS.map((op) => op.name)).toEqual([
      "type_list",
      "type_get",
      "record_list",
      "record_get",
    ]);
    expect(catalog.OPERATIONS.map((op) => op.name)).toEqual(
      read.READ_OPERATIONS.map((op) => op.name),
    );
  });

  it("宣言した全操作に実装(handler)がある", async () => {
    vi.resetModules();
    const catalog = await import("../src/ops/catalog");
    const invoke = await import("../src/ops/invoke");
    expect(Object.keys(invoke.HANDLERS).toSorted()).toEqual(
      catalog.OPERATIONS.map((op) => op.name).toSorted(),
    );
  });
});
