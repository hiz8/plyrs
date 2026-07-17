import { describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "./content-type";
import {
  extractBodyRelations,
  ASSET_IMAGE_NODE_TYPE,
  RECORD_MENTION_NODE_TYPE,
} from "./body-relations";

const UUID_A = "018f2b6a-7a0a-7000-8000-00000000000a";
const UUID_B = "018f2b6a-7a0a-7000-8000-00000000000b";

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "body", type: "richtext" },
    { key: "summary", type: "richtext" },
  ],
};

function mention(recordType: string, recordId: string, label = "x") {
  return { type: RECORD_MENTION_NODE_TYPE, attrs: { recordType, recordId, label } };
}

function envelope(...nodes: unknown[]) {
  return {
    schemaVersion: 1,
    doc: { type: "doc", content: [{ type: "paragraph", content: nodes }] },
  };
}

describe("extractBodyRelations", () => {
  it("collects mention refs per richtext field in document order", () => {
    const data = {
      title: "t",
      body: envelope(
        mention("author", UUID_A),
        { type: "text", text: " と " },
        mention("note", UUID_B),
      ),
      summary: envelope(mention("author", UUID_B)),
    };
    expect(extractBodyRelations(articleType, data)).toEqual([
      {
        fieldKey: "body",
        refs: [
          { type: "author", id: UUID_A },
          { type: "note", id: UUID_B },
        ],
      },
      { fieldKey: "summary", refs: [{ type: "author", id: UUID_B }] },
    ]);
  });

  it("dedupes the same reference keeping the first occurrence", () => {
    const data = { body: envelope(mention("author", UUID_A), mention("author", UUID_A)) };
    expect(extractBodyRelations(articleType, data)).toEqual([
      { fieldKey: "body", refs: [{ type: "author", id: UUID_A }] },
    ]);
  });

  it("finds mentions in nested block structures", () => {
    const data = {
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "blockquote",
              content: [{ type: "paragraph", content: [mention("author", UUID_A)] }],
            },
          ],
        },
      },
    };
    expect(extractBodyRelations(articleType, data)).toEqual([
      { fieldKey: "body", refs: [{ type: "author", id: UUID_A }] },
    ]);
  });

  it("skips malformed envelopes and malformed mention attrs silently", () => {
    const data = {
      body: "not an envelope",
      summary: envelope(
        mention("author", "not-a-uuid"),
        { type: RECORD_MENTION_NODE_TYPE, attrs: { recordId: UUID_A, label: "typeなし" } },
        { type: RECORD_MENTION_NODE_TYPE },
        mention("author", UUID_A),
      ),
    };
    expect(extractBodyRelations(articleType, data)).toEqual([
      { fieldKey: "summary", refs: [{ type: "author", id: UUID_A }] },
    ]);
  });

  it("returns an empty array when there are no richtext fields or no mentions", () => {
    const noRichtext: ContentTypeDefinition = {
      ...articleType,
      fields: [{ key: "title", type: "text" }],
    };
    expect(extractBodyRelations(noRichtext, { title: "t" })).toEqual([]);
    expect(
      extractBodyRelations(articleType, { body: envelope({ type: "text", text: "plain" }) }),
    ).toEqual([]);
  });
});

describe("assetImage ノードの抽出 (Phase 8 裁定 5)", () => {
  const contentTypeWithBody: ContentTypeDefinition = {
    id: "018f2b6a-7a0a-7000-8000-0000000000aa",
    key: "article",
    name: "記事",
    source: "user",
    version: 1,
    fields: [{ key: "body", type: "richtext" }],
  };
  const assetId = "018f2b6a-7a0a-7000-8000-0000000000ab";
  const mentionId = "018f2b6a-7a0a-7000-8000-0000000000ac";

  it("extracts asset references from assetImage nodes (mention と同じ attrs 契約)", () => {
    const data = {
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: ASSET_IMAGE_NODE_TYPE,
              attrs: { recordType: "asset", recordId: assetId, label: "hero.png" },
            },
            {
              type: "paragraph",
              content: [
                {
                  type: RECORD_MENTION_NODE_TYPE,
                  attrs: { recordType: "author", recordId: mentionId, label: "山田" },
                },
              ],
            },
          ],
        },
      },
    };
    expect(extractBodyRelations(contentTypeWithBody, data)).toEqual([
      {
        fieldKey: "body",
        refs: [
          { type: "asset", id: assetId },
          { type: "author", id: mentionId },
        ],
      },
    ]);
  });

  it("dedupes the same asset referenced by image and mention", () => {
    const data = {
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: ASSET_IMAGE_NODE_TYPE,
              attrs: { recordType: "asset", recordId: assetId, label: "hero.png" },
            },
            {
              type: "paragraph",
              content: [
                {
                  type: RECORD_MENTION_NODE_TYPE,
                  attrs: { recordType: "asset", recordId: assetId, label: "hero.png" },
                },
              ],
            },
          ],
        },
      },
    };
    const writes = extractBodyRelations(contentTypeWithBody, data);
    expect(writes[0]?.refs).toEqual([{ type: "asset", id: assetId }]);
  });

  it("skips assetImage nodes with malformed attrs (防御的読み)", () => {
    const data = {
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [{ type: ASSET_IMAGE_NODE_TYPE, attrs: { recordId: "not-a-uuid" } }],
        },
      },
    };
    expect(extractBodyRelations(contentTypeWithBody, data)).toEqual([]);
  });
});
