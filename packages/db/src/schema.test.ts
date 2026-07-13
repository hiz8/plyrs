import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  alarmRegistry,
  contentTypes,
  doConfig,
  outbox,
  publishedSnapshots,
  records,
  relations,
} from "./schema";

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

  it("defines the publish / outbox / alarm operational tables (design-spec §7 / §9.6 / §12.3)", () => {
    expect(getTableName(publishedSnapshots)).toBe("published_snapshots");
    expect(getTableName(outbox)).toBe("outbox");
    expect(getTableName(alarmRegistry)).toBe("alarm_registry");
    expect(getTableName(doConfig)).toBe("do_config");
  });

  it("gives the outbox its ordering and delivery bookkeeping", () => {
    expect(outbox.jobType).toBeDefined();
    expect(outbox.sourceVersion).toBeDefined();
    expect(outbox.sent).toBeDefined();
  });
});
