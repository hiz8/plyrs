import { describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "./content-type";
import { isSafeLinkHref, newUnsafeLinks } from "./link-href";
import { buildRecordInputSchema } from "./record-schema";
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
    "blob:https://example.com/x",
    "a\u0001b",
  ])("%j は拒否する", (href) => {
    expect(isSafeLinkHref(href)).toBe(false);
  });
});

describe("newUnsafeLinks(validate-on-write のリンク検査)", () => {
  it("許可リスト外の href を返す(フィールドの key 付き)", () => {
    expect(newUnsafeLinks(type, { body: linked("javascript:alert(1)") }, null)).toEqual([
      { fieldKey: "body", href: "javascript:alert(1)" },
    ]);
  });

  it("文字列でない href も返す", () => {
    expect(newUnsafeLinks(type, { body: linked(1) }, null)).toHaveLength(1);
  });

  it("管理画面のエディタ(Tiptap の既定)が許す scheme は通す", () => {
    for (const href of [
      "https://example.com",
      "ftp://example.com/a",
      "sms:+8190",
      "xmpp:a@b",
      "callto:x",
      "cid:part",
    ]) {
      expect(newUnsafeLinks(type, { body: linked(href) }, null), href).toEqual([]);
    }
  });

  it("今の値にもある href は巻き込まない(本文以外を直す保存を止めない)", () => {
    const current = { body: linked("javascript:alert(1)") };
    expect(newUnsafeLinks(type, { ...current, title: "x" }, current)).toEqual([]);
    expect(newUnsafeLinks(type, { body: linked("data:text/html,x") }, current)).toEqual([
      { fieldKey: "body", href: "data:text/html,x" },
    ]);
  });

  it("buildRecordInputSchema(形の検証)と tolerant read はリンクを見ない", () => {
    expect(buildRecordInputSchema(type).safeParse({ body: linked("javascript:x") }).success).toBe(
      true,
    );
    const result = tolerantReadData(type, { body: linked("javascript:alert(1)") });
    expect(result.invalidKeys).toEqual([]);
  });
});
