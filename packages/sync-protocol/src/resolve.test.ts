import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { describe, expect, it } from "vitest";
import type { ClientChange, SyncRecord } from "./messages";
import { resolveSyncWrite } from "./resolve";

const UUID = (n: number) => `018f2b6a-7a0a-7000-8000-00000000000${n}`;

const articleType: ContentTypeDefinition = {
  id: UUID(1),
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "subtitle", type: "text" },
    { key: "body", type: "richtext" },
    { key: "authors", type: "relation", config: { allowedTypes: ["author"], cardinality: "many" } },
  ],
};

function current(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id: UUID(2),
    type: "article",
    input: {
      title: "server title",
      subtitle: "server subtitle",
      body: { schemaVersion: 1, doc: {} },
    },
    fieldVersions: { title: 2, subtitle: 1, body: 1 },
    status: "draft",
    seq: 5,
    version: 3,
    deletedAt: null,
    updatedAt: "2026-07-13T00:00:00Z",
    updatedBy: "server-user",
    ...overrides,
  };
}

function change(overrides: Partial<ClientChange> = {}): ClientChange {
  return {
    changeId: UUID(3),
    recordId: UUID(2),
    typeKey: "article",
    op: "upsert",
    input: { title: "client title" },
    changedFields: ["title"],
    baseFieldVersions: { title: 2 },
    ...overrides,
  };
}

describe("resolveSyncWrite", () => {
  it("applies a create (no current record) verbatim", () => {
    const result = resolveSyncWrite(articleType, change({ input: { title: "new" } }), null);
    expect(result).toEqual({ kind: "apply", input: { title: "new" } });
  });

  it("applies a non-conflicting edit and merges untouched server fields", () => {
    const result = resolveSyncWrite(articleType, change(), current());
    expect(result).toEqual({
      kind: "apply",
      input: {
        title: "client title",
        subtitle: "server subtitle",
        body: { schemaVersion: 1, doc: {} },
      },
    });
  });

  it("merges concurrent edits to different fields (design-spec §10.3)", () => {
    const result = resolveSyncWrite(
      articleType,
      change({
        input: { subtitle: "client subtitle" },
        changedFields: ["subtitle"],
        baseFieldVersions: { subtitle: 1 },
      }),
      current({ fieldVersions: { title: 9, subtitle: 1, body: 1 } }),
    );
    expect(result).toEqual({
      kind: "apply",
      input: {
        title: "server title",
        subtitle: "client subtitle",
        body: { schemaVersion: 1, doc: {} },
      },
    });
  });

  it("resolves a stale scalar edit as last-write-wins", () => {
    const result = resolveSyncWrite(
      articleType,
      change({ baseFieldVersions: { title: 1 } }),
      current({ fieldVersions: { title: 7, subtitle: 1, body: 1 } }),
    );
    expect(result.kind).toBe("apply");
    if (result.kind === "apply") {
      expect(result.input["title"]).toBe("client title");
    }
  });

  it("reports a stale richtext edit as a conflict for manual resolution", () => {
    const result = resolveSyncWrite(
      articleType,
      change({
        input: { body: { schemaVersion: 1, doc: { edited: true } } },
        changedFields: ["body"],
        baseFieldVersions: { body: 1 },
      }),
      current({ fieldVersions: { title: 2, subtitle: 1, body: 4 } }),
    );
    expect(result).toEqual({
      kind: "conflict",
      conflicts: [{ fieldKey: "body", baseVersion: 1, currentVersion: 4 }],
    });
  });

  it("applies a richtext edit when the base version is current", () => {
    const result = resolveSyncWrite(
      articleType,
      change({
        input: { body: { schemaVersion: 1, doc: { edited: true } } },
        changedFields: ["body"],
        baseFieldVersions: { body: 1 },
      }),
      current(),
    );
    expect(result.kind).toBe("apply");
  });

  it("treats a changed field absent from input as a clear", () => {
    const result = resolveSyncWrite(
      articleType,
      change({ input: {}, changedFields: ["subtitle"], baseFieldVersions: { subtitle: 1 } }),
      current(),
    );
    expect(result.kind).toBe("apply");
    if (result.kind === "apply") {
      expect("subtitle" in result.input).toBe(false);
      expect(result.input["title"]).toBe("server title");
    }
  });

  it("reports every conflicting richtext field at once", () => {
    const twoBodies: ContentTypeDefinition = {
      ...articleType,
      fields: [
        { key: "body", type: "richtext" },
        { key: "notes", type: "richtext" },
      ],
    };
    const result = resolveSyncWrite(
      twoBodies,
      change({
        input: { body: {}, notes: {} },
        changedFields: ["body", "notes"],
        baseFieldVersions: { body: 1, notes: 1 },
      }),
      current({ fieldVersions: { body: 2, notes: 3 } }),
    );
    expect(result).toEqual({
      kind: "conflict",
      conflicts: [
        { fieldKey: "body", baseVersion: 1, currentVersion: 2 },
        { fieldKey: "notes", baseVersion: 1, currentVersion: 3 },
      ],
    });
  });

  it("ignores unknown changed fields (tolerant of stale client type definitions)", () => {
    const result = resolveSyncWrite(
      articleType,
      change({
        input: { legacy: "x" },
        changedFields: ["legacy"],
        baseFieldVersions: { legacy: 1 },
      }),
      current({ fieldVersions: { legacy: 5 } }),
    );
    expect(result.kind).toBe("apply");
    if (result.kind === "apply") {
      expect(result.input["legacy"]).toBe("x");
    }
  });
});

// 16.6(M2-6): strict モード(エージェント経路の既定)
describe("resolveSyncWrite strict", () => {
  const type: ContentTypeDefinition = {
    id: "018f2b6a-7a0a-7000-8000-000000000001",
    key: "article",
    name: "記事",
    source: "user",
    version: 1,
    fields: [
      { key: "title", type: "text", required: true },
      { key: "body", type: "richtext" },
    ],
  };
  const server: SyncRecord = {
    id: "018f2b6a-7a0a-7000-8000-000000000010",
    type: "article",
    input: { title: "人が直した題", body: { schemaVersion: 2, doc: { type: "doc" } } },
    fieldVersions: { title: 2, body: 1 },
    status: "draft",
    seq: 5,
    version: 3,
    deletedAt: null,
    updatedAt: "2026-11-02T00:00:00.000Z",
    updatedBy: "u1",
  };
  const change = (overrides: Partial<ClientChange>): ClientChange => ({
    changeId: "c1",
    recordId: server.id,
    typeKey: "article",
    op: "upsert",
    input: { title: "エージェントの題" },
    changedFields: ["title"],
    baseFieldVersions: { title: 2, body: 1 },
    ...overrides,
  });

  it("スカラーの版が違えば strict では conflict(merge なら LWW で apply)", () => {
    const stale = change({ baseFieldVersions: { title: 1, body: 1 } });
    expect(resolveSyncWrite(type, stale, server, "strict")).toEqual({
      kind: "conflict",
      conflicts: [{ fieldKey: "title", baseVersion: 1, currentVersion: 2 }],
    });
    expect(resolveSyncWrite(type, stale, server, "merge").kind).toBe("apply");
    expect(resolveSyncWrite(type, stale, server).kind).toBe("apply");
  });

  it("baseFieldVersions にキーが無く current が 1 以上なら conflict(省略は 0 と見る)", () => {
    const missing = change({ baseFieldVersions: {} });
    expect(resolveSyncWrite(type, missing, server, "strict")).toEqual({
      kind: "conflict",
      conflicts: [{ fieldKey: "title", baseVersion: 0, currentVersion: 2 }],
    });
  });

  it("全フィールドの版が一致すれば apply で、結果は merge と同じ(現在値に変更キーだけ重ねる)", () => {
    const fresh = change({});
    const strict = resolveSyncWrite(type, fresh, server, "strict");
    expect(strict).toEqual(resolveSyncWrite(type, fresh, server, "merge"));
    expect(strict).toEqual({
      kind: "apply",
      input: { title: "エージェントの題", body: server.input["body"] },
    });
  });

  it("新規(current が無い)は strict でも apply", () => {
    expect(resolveSyncWrite(type, change({}), null, "strict")).toEqual({
      kind: "apply",
      input: { title: "エージェントの題" },
    });
  });
});
