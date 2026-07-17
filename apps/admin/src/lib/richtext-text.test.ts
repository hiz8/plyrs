import { describe, expect, it } from "vitest";
import type { RichTextEnvelope } from "@plyrs/metamodel";
import { richTextPlainText } from "./richtext-text";

function envelope(doc: RichTextEnvelope["doc"]): RichTextEnvelope {
  return { schemaVersion: 1, doc };
}

describe("richTextPlainText", () => {
  it("flattens text nodes and mentions across blocks", () => {
    const value = envelope({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "題" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "著者は" },
            {
              type: "recordMention",
              attrs: { recordType: "author", recordId: "x", label: "山田" },
            },
            { type: "text", text: "です" },
          ],
        },
      ],
    });
    expect(richTextPlainText(value)).toBe("題 著者は @山田 です");
  });

  it("truncates long text with an ellipsis", () => {
    const value = envelope({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "あ".repeat(200) }] }],
    });
    const text = richTextPlainText(value, 10);
    expect(text).toHaveLength(11);
    expect(text.endsWith("…")).toBe(true);
  });

  it("returns an empty string for an empty document", () => {
    expect(richTextPlainText(envelope({ type: "doc", content: [] }))).toBe("");
  });
});
