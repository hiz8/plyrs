import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { projectedRecords, projectedRelations, projectionIndex } from "./projection";

describe("@plyrs/db projection schema", () => {
  it("defines the three projection tables from design-spec §12.2", () => {
    expect(getTableName(projectedRecords)).toBe("projected_records");
    expect(getTableName(projectedRelations)).toBe("projected_relations");
    expect(getTableName(projectionIndex)).toBe("projection_index");
  });

  it("carries tenant_id on every projection table (shared D1)", () => {
    expect(projectedRecords.tenantId).toBeDefined();
    expect(projectedRelations.tenantId).toBeDefined();
    expect(projectionIndex.tenantId).toBeDefined();
  });

  it("types projection_index values into text / num / date columns", () => {
    expect(projectionIndex.valueText).toBeDefined();
    expect(projectionIndex.valueNum).toBeDefined();
    expect(projectionIndex.valueDate).toBeDefined();
  });
});
