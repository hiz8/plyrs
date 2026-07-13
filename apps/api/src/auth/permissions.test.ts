import { describe, expect, it } from "vitest";
import { can, isRole } from "./permissions";

describe("default role permissions (design-spec §11.3/§11.5)", () => {
  it("bakes the owner/editor/viewer matrix", () => {
    expect(can("owner", "type:manage")).toBe(true);
    expect(can("owner", "record:delete")).toBe(true);
    expect(can("editor", "record:write")).toBe(true);
    expect(can("editor", "record:delete")).toBe(true);
    expect(can("editor", "type:manage")).toBe(false);
    expect(can("viewer", "record:read")).toBe(true);
    expect(can("viewer", "record:write")).toBe(false);
    expect(can("viewer", "record:delete")).toBe(false);
    expect(can("viewer", "type:manage")).toBe(false);
  });

  it("guards role strings from untrusted sources", () => {
    expect(isRole("owner")).toBe(true);
    expect(isRole("admin")).toBe(false);
    expect(isRole(42)).toBe(false);
  });

  it("lets owners rebuild the projection but not editors", () => {
    expect(can("owner", "projection:rebuild")).toBe(true);
    expect(can("editor", "projection:rebuild")).toBe(false);
  });

  it("lets owners and editors publish, but not viewers", () => {
    expect(can("owner", "record:publish")).toBe(true);
    expect(can("editor", "record:publish")).toBe(true);
    expect(can("viewer", "record:publish")).toBe(false);
  });
});
