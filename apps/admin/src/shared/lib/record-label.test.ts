import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it } from "vitest";
import { labelForRecord } from "./record-label";

const RECORD_ID = "0190a1b2-c3d4-7000-8000-000000000001";

function type(extra: Partial<ContentTypeDefinition> = {}): ContentTypeDefinition {
  return {
    id: "0190a1b2-c3d4-7000-8000-0000000000aa",
    key: "event",
    name: "イベント",
    fields: [
      { key: "code", type: "number" },
      { key: "title", type: "text" },
      { key: "subtitle", type: "text" },
    ],
    source: "user",
    version: 1,
    ...extra,
  };
}

function record(input: Record<string, unknown>): SyncRecord {
  return {
    id: RECORD_ID,
    type: "event",
    input,
    fieldVersions: {},
    status: "draft",
    seq: 1,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-10-17T00:00:00Z",
    updatedBy: "u1",
  };
}

describe("labelForRecord", () => {
  it("uses the first text field when titleField is unset (従来の挙動)", () => {
    expect(labelForRecord([type()], record({ title: "春祭り", subtitle: "副題" }))).toBe("春祭り");
  });

  it("uses titleField when set", () => {
    expect(
      labelForRecord(
        [type({ titleField: "subtitle" })],
        record({ title: "春祭り", subtitle: "副題" }),
      ),
    ).toBe("副題");
  });

  it("falls back to the id prefix when the title value is empty or the type is unknown", () => {
    expect(labelForRecord([type({ titleField: "subtitle" })], record({ subtitle: "" }))).toBe(
      RECORD_ID.slice(0, 8),
    );
    expect(labelForRecord([], record({ title: "春祭り" }))).toBe(RECORD_ID.slice(0, 8));
  });
});
