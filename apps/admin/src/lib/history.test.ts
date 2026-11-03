import { describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import {
  actorLabel,
  formatFieldDiff,
  formatFieldValue,
  summarizeEntry,
  viaLabel,
  type HistoryEntry,
} from "./history";

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  historySeq: 3,
  kind: "write",
  version: 3,
  sourceVersion: null,
  status: "draft",
  changedFields: ["title", "body", "slug"],
  actor: "018f2b6a-7a0a-7000-8000-0000000000aa",
  via: "mcp",
  tokenId: "tok",
  clientId: null,
  restoredFrom: null,
  createdAt: "2026-11-02T00:00:00.000Z",
  updatedAt: "2026-11-02T00:05:00.000Z",
  ...overrides,
});

const members = [{ userId: "018f2b6a-7a0a-7000-8000-0000000000aa", email: "ai@example.com" }];

const type: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", label: "タイトル", required: true },
    { key: "body", type: "richtext" },
    { key: "hero", type: "relation", config: { allowedTypes: ["asset"], cardinality: "one" } },
  ],
};

describe("履歴の文言", () => {
  it("経路のラベルは 管理画面 / MCP / API", () => {
    expect([viaLabel("sync"), viaLabel("mcp"), viaLabel("rest")]).toEqual([
      "管理画面",
      "MCP",
      "API",
    ]);
  });

  it("actor はメンバーのメール、無ければ ID の先頭 8 桁、モジュールの actor はそのまま", () => {
    expect(actorLabel(members[0]!.userId, members)).toBe("ai@example.com");
    expect(actorLabel("018f2b6a-7a0a-7000-8000-0000000000bb", members)).toBe("018f2b6a");
    expect(actorLabel("module:booking")).toBe("module:booking");
  });

  it("要約: 「○○ がMCPから 3 フィールドを変更」、publish / restore は種類で変わる", () => {
    expect(summarizeEntry(entry(), members)).toBe("ai@example.com がMCPから 3 フィールドを変更");
    expect(summarizeEntry(entry({ kind: "publish", via: "rest" }), members)).toBe(
      "ai@example.com がAPIから公開",
    );
    expect(summarizeEntry(entry({ kind: "restore", via: "sync", restoredFrom: 1 }), members)).toBe(
      "ai@example.com が管理画面から版 1 に復元",
    );
  });
});

describe("差分の整形", () => {
  it("richtext は平文の抜粋、relation は参照 ID、未設定は (未設定)、他は JSON", () => {
    const body = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "本文です" }] }],
      },
    };
    expect(formatFieldDiff({ key: "body", before: undefined, after: body }, type)).toEqual({
      key: "body",
      label: "body",
      before: "(未設定)",
      after: "本文です",
    });
    expect(
      formatFieldDiff({ key: "hero", before: { type: "asset", id: "a1" }, after: null }, type),
    ).toMatchObject({
      before: "a1",
      after: "(未設定)",
    });
    expect(formatFieldDiff({ key: "title", before: "旧", after: "新" }, type)).toMatchObject({
      label: "タイトル",
      before: "旧",
      after: "新",
    });
    expect(formatFieldValue({ a: 1 }, undefined)).toBe('{"a":1}');
    expect(formatFieldValue("", undefined)).toBe("(空)");
  });
});
