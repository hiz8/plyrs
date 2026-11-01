// Tiptap JSON ⇄ Portable Text。既製の直接変換器は無いので、
//   Tiptap JSON → HTML(@tiptap/static-renderer)→ Portable Text(@portabletext/html)
//   Portable Text → HTML(@portabletext/to-html)→ Tiptap JSON(@tiptap/html generateJSON)
// の 2 段で往復させる。HTML を経由するのは Portable Text 側の公式ツールが HTML 入出力しか
// 持たないため。(b) 案を採る場合、本実装ではこの経路をそのまま使うか、直接変換器を書く。
import type { JSONContent } from "@tiptap/core";
import { generateJSON } from "@tiptap/html";
import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import { htmlToPortableText, type DeserializerRule } from "@portabletext/html";
import { compileSchema, defineSchema } from "@portabletext/schema";
import { toHTML, type PortableTextHtmlComponents } from "@portabletext/to-html";
import type { PortableTextBlock } from "@portabletext/types";
import { JSDOM } from "jsdom";
import { plyrsExtensions } from "./extensions";

// Plyrs の語彙を Portable Text のスキーマで表す。
// - 段落・見出し・引用は style、箇条書き/番号は listItem + level、マークは decorator、
//   リンクは annotation(markDefs)、コードブロック・区切り線・画像は blockObject、
//   record 参照は inlineObject。
export const plyrsPortableTextSchema = compileSchema(
  defineSchema({
    styles: [{ name: "normal" }, { name: "h1" }, { name: "h2" }, { name: "h3" }, { name: "blockquote" }],
    decorators: [
      { name: "strong" },
      { name: "em" },
      { name: "underline" },
      { name: "strike-through" },
      { name: "code" },
    ],
    annotations: [{ name: "link", fields: [{ name: "href", type: "string" }] }],
    lists: [{ name: "bullet" }, { name: "number" }],
    blockObjects: [
      { name: "codeBlock", fields: [{ name: "code", type: "string" }, { name: "language", type: "string" }] },
      { name: "horizontalRule", fields: [] },
      {
        name: "assetImage",
        fields: [
          { name: "recordType", type: "string" },
          { name: "recordId", type: "string" },
          { name: "label", type: "string" },
        ],
      },
    ],
    inlineObjects: [
      {
        name: "recordMention",
        fields: [
          { name: "recordType", type: "string" },
          { name: "recordId", type: "string" },
          { name: "label", type: "string" },
        ],
      },
    ],
  }),
);

let keyCounter = 0;
const keyGenerator = () => `k${(++keyCounter).toString(36)}`;

const rules: DeserializerRule[] = [
  {
    // <pre><code class="language-ts">…</code></pre> → codeBlock
    deserialize(node, _next, createBlock) {
      const el = node as HTMLElement;
      if (el.tagName?.toLowerCase() !== "pre") return undefined;
      const code = el.firstElementChild?.tagName?.toLowerCase() === "code" ? el.firstElementChild : el;
      const cls = code.getAttribute("class") ?? "";
      const language = cls.startsWith("language-") ? cls.slice("language-".length) : undefined;
      return createBlock({ _type: "codeBlock", code: code.textContent ?? "", ...(language ? { language } : {}) });
    },
  },
  {
    deserialize(node, _next, createBlock) {
      const el = node as HTMLElement;
      if (el.tagName?.toLowerCase() !== "hr") return undefined;
      return createBlock({ _type: "horizontalRule" });
    },
  },
  {
    deserialize(node, _next, createBlock) {
      const el = node as HTMLElement;
      if (el.tagName?.toLowerCase() !== "img" || el.getAttribute("data-type") !== "assetImage") return undefined;
      return createBlock({
        _type: "assetImage",
        recordType: el.getAttribute("data-record-type") ?? "asset",
        recordId: el.getAttribute("data-record-id") ?? "",
        label: el.getAttribute("data-label") ?? "",
      });
    },
  },
  {
    deserialize(node) {
      const el = node as HTMLElement;
      if (el.tagName?.toLowerCase() !== "span" || el.getAttribute("data-type") !== "recordMention") return undefined;
      return {
        _type: "recordMention",
        _key: keyGenerator(),
        recordType: el.getAttribute("data-record-type") ?? "",
        recordId: el.getAttribute("data-record-id") ?? "",
        label: el.getAttribute("data-label") ?? "",
      };
    },
  },
];

export function tiptapToHtml(doc: JSONContent): string {
  return renderToHTMLString({ content: doc, extensions: plyrsExtensions() });
}

export function tiptapToPortableText(doc: JSONContent): PortableTextBlock[] {
  // @portabletext/html の戻り型は _key を付け直した緩い型なので PortableTextBlock へ境界 cast
  return htmlToPortableText(tiptapToHtml(doc), {
    schema: plyrsPortableTextSchema,
    rules,
    keyGenerator,
    parseHtml: (html) => new JSDOM(html).window.document,
  }) as PortableTextBlock[];
}

const components: Partial<PortableTextHtmlComponents> = {
  types: {
    codeBlock: ({ value }) => {
      const v = value as { code?: string; language?: string };
      const cls = v.language ? ` class="language-${v.language}"` : "";
      return `<pre><code${cls}>${escapeHtml(v.code ?? "")}</code></pre>`;
    },
    horizontalRule: () => "<hr>",
    assetImage: ({ value }) => {
      const v = value as { recordType?: string; recordId?: string; label?: string };
      return `<img data-type="assetImage" data-record-type="${v.recordType ?? "asset"}" data-record-id="${v.recordId ?? ""}" data-label="${escapeHtml(v.label ?? "")}" alt="${escapeHtml(v.label ?? "")}">`;
    },
    recordMention: ({ value }) => {
      const v = value as { recordType?: string; recordId?: string; label?: string };
      return `<span data-type="recordMention" data-record-type="${v.recordType ?? ""}" data-record-id="${v.recordId ?? ""}" data-label="${escapeHtml(v.label ?? "")}">@${escapeHtml(v.label ?? "")}</span>`;
    },
  },
  marks: {
    underline: ({ children }) => `<u>${children}</u>`,
    "strike-through": ({ children }) => `<s>${children}</s>`,
    link: ({ children, value }) => `<a href="${escapeHtml((value as { href?: string }).href ?? "")}">${children}</a>`,
  },
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function portableTextToHtml(blocks: PortableTextBlock[]): string {
  return toHTML(blocks, { components });
}

export function portableTextToTiptap(blocks: PortableTextBlock[]): JSONContent {
  return generateJSON(portableTextToHtml(blocks), plyrsExtensions());
}
