import { describe, expect, it } from "vitest";
import { createSlotRegistry } from "./slots";

describe("SlotRegistry (design-spec §9.9 論点P 初版)", () => {
  it("returns contributions sorted by order then id", () => {
    const registry = createSlotRegistry();
    registry.register("nav:item", { id: "b", label: "B", to: "/t/$tenantSlug/b", order: 10 });
    registry.register("nav:item", { id: "a", label: "A", to: "/t/$tenantSlug/a", order: 0 });
    registry.register("nav:item", { id: "c", label: "C", to: "/t/$tenantSlug/c", order: 10 });
    expect(registry.get("nav:item").map((item) => item.id)).toStrictEqual(["a", "b", "c"]);
  });

  it("returns an empty list for a slot with no contributions", () => {
    const registry = createSlotRegistry();
    expect(registry.get("nav:item")).toStrictEqual([]);
  });

  it("rejects duplicate contribution ids per slot", () => {
    const registry = createSlotRegistry();
    registry.register("nav:item", { id: "x", label: "X", to: "/t/$tenantSlug/x", order: 0 });
    expect(() =>
      registry.register("nav:item", { id: "x", label: "X2", to: "/t/$tenantSlug/x2", order: 1 }),
    ).toThrow(/duplicate/);
  });

  it("does not mutate the stored order via the returned array", () => {
    const registry = createSlotRegistry();
    registry.register("nav:item", { id: "a", label: "A", to: "/t/$tenantSlug/a", order: 0 });
    registry.get("nav:item").pop();
    expect(registry.get("nav:item").length).toBe(1);
  });
});
