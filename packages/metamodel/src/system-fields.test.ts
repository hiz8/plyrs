import { describe, expect, it } from "vitest";
import { SYSTEM_FIELD_KEYS, WORKFLOW_STATUSES } from "./system-fields";

describe("system fields", () => {
  it("defines the seven system field keys from design-spec §5", () => {
    expect(SYSTEM_FIELD_KEYS).toEqual([
      "id",
      "createdAt",
      "updatedAt",
      "createdBy",
      "updatedBy",
      "status",
      "version",
    ]);
  });

  it("defines the four workflow statuses from design-spec §7 (no 'published')", () => {
    expect(WORKFLOW_STATUSES).toEqual(["draft", "in_review", "ready", "archived"]);
    expect(WORKFLOW_STATUSES).not.toContain("published");
  });
});
