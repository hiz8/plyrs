import { describe, expect, it } from "vitest";
import { richTextToMarkdown } from "./richtext-markdown";

// M1-6(論点 E1 / M0-2 結果 3 節): リッチテキスト(Tiptap JSON)を Markdown に一方向変換する。
// workerd 上(@cloudflare/vitest-plugin)で @tiptap/markdown が DOM 無しで動くことの確認を兼ねる。

const ID = "019a0000-0000-7000-8000-000000000001";

describe("richTextToMarkdown", () => {
  it("見出し・太字・リンク・箇条書きを Markdown にする", () => {
    const markdown = richTextToMarkdown({
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "見出し" }] },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "太字", marks: [{ type: "bold" }] },
              { type: "text", text: " と " },
              {
                type: "text",
                text: "リンク",
                marks: [{ type: "link", attrs: { href: "https://example.com/" } }],
              },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "項目" }] }],
              },
            ],
          },
        ],
      },
    });
    expect(markdown).toContain("## 見出し");
    expect(markdown).toContain("**太字** と [リンク](https://example.com/)");
    expect(markdown).toContain("- 項目");
  });

  it("record 参照と本文中画像は独自の形で書き出す", () => {
    const markdown = richTextToMarkdown({
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "著者: " },
              {
                type: "recordMention",
                attrs: { recordType: "author", recordId: ID, label: "山田" },
              },
            ],
          },
          { type: "assetImage", attrs: { recordType: "asset", recordId: ID, label: "hero.png" } },
        ],
      },
    });
    expect(markdown).toContain(`著者: [@ recordType="author" recordId="${ID}" label="山田"]`);
    expect(markdown).toContain(`![hero.png](plyrs://asset/${ID})`);
  });

  it("空の本文は空文字", () => {
    expect(richTextToMarkdown({ schemaVersion: 1, doc: { type: "doc", content: [] } })).toBe("");
  });
});
