import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { contentTypes, records, relations } from "./schema";

describe("@plyrs/db schema", () => {
  it("defines the three DO core tables from design-spec §6", () => {
    expect(getTableName(contentTypes)).toBe("content_types");
    expect(getTableName(records)).toBe("records");
    expect(getTableName(relations)).toBe("relations");
  });

  it("gives records the sync bookkeeping columns (seq / field_versions / deleted_at)", () => {
    expect(records.seq).toBeDefined();
    expect(records.fieldVersions).toBeDefined();
    expect(records.deletedAt).toBeDefined();
  });
});
