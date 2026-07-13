import type { ClientChange, SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it } from "vitest";
import { SyncRejectedError } from "./errors";
import { Outbox } from "./outbox";
import { MemorySyncStorage } from "./storage";

function change(id: string): ClientChange {
  return {
    changeId: id,
    recordId: "r1",
    typeKey: "article",
    op: "upsert",
    input: { title: "hi" },
    changedFields: ["title"],
    baseFieldVersions: {},
  };
}

function record(): SyncRecord {
  return {
    id: "r1",
    type: "article",
    input: { title: "hi" },
    fieldVersions: { title: 1 },
    status: "draft",
    seq: 3,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-13T00:00:00Z",
    updatedBy: "u1",
  };
}

describe("Outbox", () => {
  it("resolves the pending promise with the acked record", async () => {
    const outbox = new Outbox(new MemorySyncStorage());
    const { acked } = await outbox.enqueue(change("c1"));
    expect(outbox.pending().map((entry) => entry.changeId)).toEqual(["c1"]);

    await outbox.settle("c1", { ok: true, record: record() });
    expect(await acked).toEqual(record());
    expect(outbox.pending()).toEqual([]);
  });

  it("rejects with SyncRejectedError carrying the conflicts", async () => {
    const outbox = new Outbox(new MemorySyncStorage());
    const { acked } = await outbox.enqueue(change("c2"));
    await outbox.settle("c2", {
      ok: false,
      code: "conflict",
      message: "manual resolution required",
      conflicts: [{ fieldKey: "body", baseVersion: 1, currentVersion: 4 }],
    });

    await expect(acked).rejects.toBeInstanceOf(SyncRejectedError);
    await expect(acked).rejects.toMatchObject({ code: "conflict" });
    expect(outbox.pending()).toEqual([]);
  });

  it("persists pending changes and restores them on hydrate", async () => {
    const storage = new MemorySyncStorage();
    const outbox = new Outbox(storage);
    await outbox.enqueue(change("c3"));
    expect(await storage.loadOutbox()).toHaveLength(1);

    const revived = new Outbox(storage);
    const restored = await revived.hydrate();
    expect(restored.map((entry) => entry.changeId)).toEqual(["c3"]);
    expect(revived.pending().map((entry) => entry.changeId)).toEqual(["c3"]);
  });

  it("ignores an ack for an unknown changeId", async () => {
    const outbox = new Outbox(new MemorySyncStorage());
    await expect(outbox.settle("nope", { ok: true, record: record() })).resolves.toBeUndefined();
  });

  it("fails every pending change when the connection is terminated", async () => {
    const outbox = new Outbox(new MemorySyncStorage());
    const { acked: first } = await outbox.enqueue(change("c4"));
    const { acked: second } = await outbox.enqueue(change("c5"));

    await outbox.failAll(new Error("blocked"));
    await expect(first).rejects.toThrow("blocked");
    await expect(second).rejects.toThrow("blocked");
    expect(outbox.pending()).toEqual([]);
  });

  it("keeps enqueue order for redelivery", async () => {
    const outbox = new Outbox(new MemorySyncStorage());
    await outbox.enqueue(change("c6"));
    await outbox.enqueue(change("c7"));
    expect(outbox.pending().map((entry) => entry.changeId)).toEqual(["c6", "c7"]);
  });
});
