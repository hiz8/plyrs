import type { JSONContent } from "@tiptap/core";

export interface Fixture {
  name: string;
  /** 設計上の意味(報告書の行の説明) */
  note: string;
  doc: JSONContent;
}

const MENTION = {
  type: "recordMention",
  attrs: { recordType: "author", recordId: "018f2b6a-7a0a-7000-8000-000000000001", label: "山田" },
};
const IMAGE = {
  type: "assetImage",
  attrs: { recordType: "asset", recordId: "018f2b6a-7a0a-7000-8000-000000000002", label: "hero.png" },
};

function p(...content: JSONContent[]): JSONContent {
  return { type: "paragraph", content };
}
function t(text: string, marks?: JSONContent["marks"]): JSONContent {
  return marks ? { type: "text", text, marks } : { type: "text", text };
}

// Tiptap StarterKit(見出し 1-3 設定)+ 独自 2 ノードの全ノード種・全マーク種。
export const fixtures: Fixture[] = [
  { name: "paragraph", note: "段落", doc: { type: "doc", content: [p(t("本文です。"))] } },
  {
    name: "heading",
    note: "見出し 1〜3",
    doc: {
      type: "doc",
      content: [1, 2, 3].map((level) => ({
        type: "heading",
        attrs: { level },
        content: [t(`見出し${level}`)],
      })),
    },
  },
  {
    name: "marks",
    note: "太字・斜体・取り消し線・下線・インラインコード",
    doc: {
      type: "doc",
      content: [
        p(
          t("太字", [{ type: "bold" }]),
          t("斜体", [{ type: "italic" }]),
          t("取り消し", [{ type: "strike" }]),
          t("下線", [{ type: "underline" }]),
          t("code", [{ type: "code" }]),
        ),
      ],
    },
  },
  {
    name: "marks-nested",
    note: "重ねたマーク(太字 + 斜体 + リンク)",
    doc: {
      type: "doc",
      content: [
        p(
          t("重ね", [
            { type: "bold" },
            { type: "italic" },
            { type: "link", attrs: { href: "https://example.com/a", target: "_blank", rel: "noopener noreferrer nofollow", class: null } },
          ]),
        ),
      ],
    },
  },
  {
    name: "link",
    note: "外部リンク(href・target・rel)",
    doc: {
      type: "doc",
      content: [
        p(
          t("リンク", [
            { type: "link", attrs: { href: "https://example.com/?a=1&b=2", target: "_blank", rel: "noopener noreferrer nofollow", class: null } },
          ]),
        ),
      ],
    },
  },
  {
    name: "bulletList",
    note: "箇条書き(2 階層の入れ子)",
    doc: {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [p(t("一"))] },
            {
              type: "listItem",
              content: [
                p(t("二")),
                { type: "bulletList", content: [{ type: "listItem", content: [p(t("二の一"))] }] },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    name: "orderedList-start",
    note: "番号リスト(start=3)",
    doc: {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 3, type: null },
          content: [
            { type: "listItem", content: [p(t("三"))] },
            { type: "listItem", content: [p(t("四"))] },
          ],
        },
      ],
    },
  },
  {
    name: "listItem-multi-paragraph",
    note: "1 つの項目に 2 段落",
    doc: {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [p(t("前半")), p(t("後半"))] }],
        },
      ],
    },
  },
  {
    name: "blockquote",
    note: "引用(段落 2 つ)",
    doc: { type: "doc", content: [{ type: "blockquote", content: [p(t("一文目")), p(t("二文目"))] }] },
  },
  {
    name: "blockquote-nested-list",
    note: "引用の中の箇条書き",
    doc: {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            p(t("前置き")),
            { type: "bulletList", content: [{ type: "listItem", content: [p(t("項目"))] }] },
          ],
        },
      ],
    },
  },
  {
    name: "codeBlock",
    note: "コードブロック(language 付き、複数行)",
    doc: {
      type: "doc",
      content: [
        { type: "codeBlock", attrs: { language: "ts" }, content: [t("const a = 1;\nconsole.log(a);")] },
      ],
    },
  },
  {
    name: "codeBlock-no-language",
    note: "コードブロック(language 無し、Markdown 風の記号を含む)",
    doc: {
      type: "doc",
      content: [{ type: "codeBlock", attrs: { language: null }, content: [t("# not a heading\n* not a list")] }],
    },
  },
  {
    name: "hardBreak",
    note: "段落内の改行",
    doc: { type: "doc", content: [p(t("一行目"), { type: "hardBreak" }, t("二行目"))] },
  },
  {
    name: "horizontalRule",
    note: "区切り線",
    doc: { type: "doc", content: [p(t("前")), { type: "horizontalRule" }, p(t("後"))] },
  },
  {
    name: "recordMention",
    note: "本文中の record 参照(インライン独自ノード)",
    doc: { type: "doc", content: [p(t("著者は "), MENTION, t(" です"))] },
  },
  {
    name: "assetImage",
    note: "本文中の画像(ブロック独自ノード)",
    doc: { type: "doc", content: [p(t("図:")), IMAGE, p(t("以上"))] },
  },
  {
    name: "empty-paragraphs",
    note: "空段落の連続(エディタで Enter を連打した状態)",
    doc: { type: "doc", content: [p(t("前")), { type: "paragraph" }, { type: "paragraph" }, p(t("後"))] },
  },
  {
    name: "markdown-special-chars",
    note: "Markdown の記号を含む平文(* _ ` # [ ] < >)",
    doc: { type: "doc", content: [p(t("a*b_c`d#e[f]<g>h"))] },
  },
  {
    name: "whitespace",
    note: "先頭・末尾・連続の空白",
    doc: { type: "doc", content: [p(t("  前  中  後  "))] },
  },
];
