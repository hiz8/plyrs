import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it, vi } from "vitest";
import { FakeSocket } from "../test-utils/fake-socket";
import { createTenantSync } from "./sync";

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [{ key: "title", type: "text", required: true }],
};

function record(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id: "r1",
    type: "article",
    input: { title: "hello" },
    fieldVersions: { title: 1 },
    status: "draft",
    seq: 3,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

async function readySync() {
  const socket = new FakeSocket();
  const sync = createTenantSync({ connect: async () => socket, reconnectDelaysMs: [0, 0] });
  sync.start();
  await vi.waitFor(() => expect(socket.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }));
  return { socket, sync };
}

describe("createTenantSync（ロードマップ §8 配線契約 5 点）", () => {
  it("wires onContentTypes → registry.sync and exposes the types", async () => {
    const { socket, sync } = await readySync();
    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 0,
    });
    await vi.waitFor(() => expect(sync.getTypes().map((t) => t.key)).toStrictEqual(["article"]));
    expect(sync.registry.get("article")).toBeDefined();
  });

  it("wires onReady/onStoreChange: synced records land in the collection", async () => {
    const { socket, sync } = await readySync();
    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 3,
    });
    socket.deliver({ type: "sync", records: [record()], serverSeq: 3, complete: true });
    await vi.waitFor(() => expect(sync.getStatus()).toBe("ready"));
    expect(sync.registry.get("article")?.get("r1")?.input["title"]).toBe("hello");
  });

  it("wires onReset: a server reset truncates the collections", async () => {
    const { socket, sync } = await readySync();
    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 3,
    });
    socket.deliver({ type: "sync", records: [record()], serverSeq: 3, complete: true });
    await vi.waitFor(() => expect(sync.getStatus()).toBe("ready"));
    // serverSeq < checkpoint = サーバーリセット（engine が store.clear + onReset を呼ぶ）
    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 1,
    });
    await vi.waitFor(() => expect(sync.registry.get("article")?.get("r1")).toBeUndefined());
  });

  it("notifies subscribers on status changes and stops notifying after unsubscribe", async () => {
    const socket = new FakeSocket();
    const sync = createTenantSync({ connect: async () => socket, reconnectDelaysMs: [0, 0] });
    const seen: string[] = [];
    const unsubscribe = sync.subscribe(() => seen.push(sync.getStatus()));
    sync.start();
    await vi.waitFor(() => expect(seen).toContain("syncing"));
    unsubscribe();
    const count = seen.length;
    sync.stop();
    expect(seen.length).toBe(count);
  });
});
