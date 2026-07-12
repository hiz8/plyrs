import type { ContentTypeDefinition } from "@plyrs/metamodel";

// 16進数字のみで構成される決定的な小文字 UUID（v7 形式）
export function uuid(n: number): string {
  return `018f2b6a-7a0a-7000-8000-${n.toString().padStart(12, "0")}`;
}

export function articleType(): ContentTypeDefinition {
  return {
    id: uuid(1),
    key: "article",
    name: "記事",
    source: "user",
    version: 1,
    fields: [
      { key: "title", type: "text", required: true, config: { maxLength: 200 } },
      { key: "slug", type: "text", required: true, config: { unique: true, indexed: true } },
      { key: "published_at", type: "datetime", config: { indexed: true } },
      {
        key: "tags",
        type: "select",
        config: {
          options: [
            { value: "tech", label: "Tech" },
            { value: "life", label: "Life" },
          ],
          multiple: true,
        },
      },
      { key: "body", type: "richtext" },
      {
        key: "authors",
        type: "relation",
        required: true,
        config: { allowedTypes: ["author"], cardinality: "many", ordered: true },
      },
      { key: "hero", type: "relation", config: { allowedTypes: ["asset"], cardinality: "one" } },
    ],
  };
}

export function validArticleInput(): Record<string, unknown> {
  return {
    title: "こんにちは",
    slug: "hello",
    published_at: "2026-07-12T00:00:00Z",
    tags: ["tech"],
    body: { schemaVersion: 1, doc: { type: "doc", content: [] } },
    authors: [
      { type: "author", id: uuid(2) },
      { type: "author", id: uuid(3) },
    ],
    hero: { type: "asset", id: uuid(4) },
  };
}
