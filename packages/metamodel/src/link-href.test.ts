import { describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "./content-type";
import { isSafeLinkHref } from "./link-href";
import { buildRecordInputSchema, recordInputJsonSchema } from "./record-schema";
import { tolerantReadData } from "./tolerant-read";

const linked = (href: unknown) => ({
  schemaVersion: 2,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href } }] }],
      },
    ],
  },
});

const type: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [{ key: "body", type: "richtext" }],
};

describe("isSafeLinkHref(M4: リンクの scheme の許可リスト)", () => {
  it.each([
    "https://example.com/a",
    "http://example.com",
    "HTTPS://EXAMPLE.COM",
    "mailto:a@example.com",
    "tel:+81-3-0000-0000",
    "/articles/a",
    "../a",
    "#section",
    "?q=1",
    "page.html",
  ])("%s は許す", (href) => {
    expect(isSafeLinkHref(href)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "\u0000javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "javascript\r:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "a\u0001b",
  ])("%j は拒否する", (href) => {
    expect(isSafeLinkHref(href)).toBe(false);
  });
});

describe("validate-on-write のリンク検査", () => {
  const schema = buildRecordInputSchema(type);

  it("許可リスト外の href を持つ richtext は書き込めない", () => {
    const result = schema.safeParse({ body: linked("javascript:alert(1)") });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["body"]);
    expect(result.error?.issues[0]?.message).toContain("link href is not allowed");
  });

  it("文字列でない href も拒否する", () => {
    expect(schema.safeParse({ body: linked(1) }).success).toBe(false);
  });

  it("https のリンクは書き込める", () => {
    expect(schema.safeParse({ body: linked("https://example.com") }).success).toBe(true);
  });

  it("tolerant read は既に保存された値を読めなくしない", () => {
    const result = tolerantReadData(type, { body: linked("javascript:alert(1)") });
    expect(result.values["body"]).toEqual(linked("javascript:alert(1)"));
    expect(result.invalidKeys).toEqual([]);
  });

  it("JSON Schema の生成は壊れない", () => {
    expect(() => recordInputJsonSchema(type)).not.toThrow();
  });
});
