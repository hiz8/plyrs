import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it } from "vitest";
import { RecordStore } from "./store";

function record(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id: "r1",
    type: "article",
    input: { title: "hello" },
    fieldVersions: { title: 1 },
    status: "draft",
    seq: 1,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-13T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

describe("RecordStore", () => {
  it("applies a new record and exposes it", () => {
    const store = new RecordStore();
    expect(store.apply(record())).toEqual({ kind: "upsert", record: record() });
    expect(store.get("r1")?.input["title"]).toBe("hello");
    expect(store.listByType("article")).toHaveLength(1);
    expect(store.seqOf("r1")).toBe(1);
  });

  it("ignores a duplicate or older delivery (idempotent by seq)", () => {
    const store = new RecordStore();
    store.apply(record({ seq: 5, input: { title: "new" } }));
    expect(store.apply(record({ seq: 5, input: { title: "stale" } }))).toBeNull();
    expect(store.apply(record({ seq: 3, input: { title: "older" } }))).toBeNull();
    expect(store.get("r1")?.input["title"]).toBe("new");
  });

  it("applies a newer delivery over an older one", () => {
    const store = new RecordStore();
    store.apply(record({ seq: 2, input: { title: "old" } }));
    const change = store.apply(record({ seq: 7, input: { title: "newer" } }));
    expect(change).toMatchObject({ kind: "upsert" });
    expect(store.get("r1")?.input["title"]).toBe("newer");
    expect(store.seqOf("r1")).toBe(7);
  });

  it("removes a record on a tombstone and remembers its seq", () => {
    const store = new RecordStore();
    store.apply(record({ seq: 2 }));
    const change = store.apply(record({ seq: 4, deletedAt: "2026-07-13T01:00:00Z", input: {} }));
    expect(change).toEqual({ kind: "delete", recordId: "r1", typeKey: "article" });
    expect(store.get("r1")).toBeUndefined();
    expect(store.listByType("article")).toHaveLength(0);
    expect(store.seqOf("r1")).toBe(4);
  });

  it("does not resurrect a deleted record from an older delivery", () => {
    const store = new RecordStore();
    store.apply(record({ seq: 4, deletedAt: "2026-07-13T01:00:00Z", input: {} }));
    expect(store.apply(record({ seq: 3, input: { title: "zombie" } }))).toBeNull();
    expect(store.get("r1")).toBeUndefined();
  });

  it("lists by type in seq order and clears everything", () => {
    const store = new RecordStore();
    store.apply(record({ id: "b", seq: 9 }));
    store.apply(record({ id: "a", seq: 4 }));
    store.apply(record({ id: "n", type: "note", seq: 6 }));
    expect(store.listByType("article").map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(store.listByType("note").map((entry) => entry.id)).toEqual(["n"]);

    store.clear();
    expect(store.listByType("article")).toHaveLength(0);
    expect(store.seqOf("a")).toBe(0);
  });
});
