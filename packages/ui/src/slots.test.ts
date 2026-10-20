import { describe, expect, it } from "vitest";
import { createSlotRegistry } from "./slots";

function Widget() {
  return null;
}

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

  it("keeps group and params on nav items (案 A 4 章)", () => {
    const registry = createSlotRegistry();
    registry.register("nav:item", {
      id: "booking.calendar",
      label: "予約カレンダー",
      to: "/t/$tenantSlug/records/$typeKey",
      params: { typeKey: "booking.slot" },
      group: "module:booking",
      order: 0,
    });
    expect(registry.get("nav:item")[0]).toMatchObject({
      params: { typeKey: "booking.slot" },
      group: "module:booking",
    });
  });

  it("registers home widgets in order (案 B 2.5)", () => {
    const registry = createSlotRegistry();
    registry.register("home:widget", { id: "b", title: "B", order: 1, render: Widget });
    registry.register("home:widget", { id: "a", title: "今日の予約", order: 0, render: Widget });
    expect(registry.get("home:widget").map((widget) => widget.title)).toStrictEqual([
      "今日の予約",
      "B",
    ]);
  });

  it("home:widget は size と moduleId を持てる", () => {
    const registry = createSlotRegistry();
    registry.register("home:widget", {
      id: "booking.today",
      title: "今日の予約",
      order: 0,
      render: Widget,
      size: "full",
      moduleId: "booking",
    });
    expect(registry.get("home:widget")[0]?.size).toBe("full");
    expect(registry.get("home:widget")[0]?.moduleId).toBe("booking");
  });
});
