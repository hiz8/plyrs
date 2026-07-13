import { describe, expect, it } from "vitest";
import { SyncRejectedError } from "./errors";
import { MemorySyncStorage } from "./storage";

const CHANGE = {
  changeId: "018f2b6a-7a0a-7000-8000-000000000001",
  recordId: "018f2b6a-7a0a-7000-8000-000000000002",
  typeKey: "article",
  op: "upsert" as const,
  input: { title: "hi" },
  changedFields: ["title"],
  baseFieldVersions: { title: 1 },
};

describe("MemorySyncStorage", () => {
  it("starts at checkpoint 0 with an empty outbox", async () => {
    const storage = new MemorySyncStorage();
    expect(await storage.loadCheckpoint()).toBe(0);
    expect(await storage.loadOutbox()).toEqual([]);
  });

  it("round-trips the checkpoint and the outbox", async () => {
    const storage = new MemorySyncStorage();
    await storage.saveCheckpoint(42);
    await storage.saveOutbox([CHANGE]);
    expect(await storage.loadCheckpoint()).toBe(42);
    expect(await storage.loadOutbox()).toEqual([CHANGE]);
  });

  it("returns a defensive copy of the outbox", async () => {
    const storage = new MemorySyncStorage();
    await storage.saveOutbox([CHANGE]);
    const loaded = await storage.loadOutbox();
    loaded.push({ ...CHANGE, changeId: "018f2b6a-7a0a-7000-8000-000000000003" });
    expect(await storage.loadOutbox()).toHaveLength(1);
  });
});

describe("SyncRejectedError", () => {
  it("carries the ack's code and conflicts", () => {
    const error = new SyncRejectedError("conflict", "manual resolution required", [
      { fieldKey: "body", baseVersion: 1, currentVersion: 4 },
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("conflict");
    expect(error.conflicts[0]?.fieldKey).toBe("body");
    expect(error.message).toBe("manual resolution required");
  });
});
