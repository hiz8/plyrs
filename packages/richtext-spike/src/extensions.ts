// 試作用のスキーマ。packages/ui の RichTextEditor と同じ語彙(StarterKit 見出し 1-3 +
// recordMention + assetImage)を、React / StyleX を引かずに再現する。ノード名と attrs は
// @plyrs/metamodel の RECORD_MENTION_NODE_TYPE / ASSET_IMAGE_NODE_TYPE との契約に合わせる。
import { Node, createInlineMarkdownSpec, type AnyExtension } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import StarterKit from "@tiptap/starter-kit";
import { ASSET_IMAGE_NODE_TYPE, RECORD_MENTION_NODE_TYPE } from "@plyrs/metamodel";

function attr(node: { attrs: Record<string, unknown> }, name: string): string {
  return String(node.attrs[name] ?? "");
}

const refAttributes = {
  recordType: {
    default: "",
    parseHTML: (element: HTMLElement) => element.getAttribute("data-record-type") ?? "",
  },
  recordId: {
    default: "",
    parseHTML: (element: HTMLElement) => element.getAttribute("data-record-id") ?? "",
  },
  label: {
    default: "",
    parseHTML: (element: HTMLElement) => element.getAttribute("data-label") ?? "",
  },
};

// Markdown 表現(試作の仮の文法。M2-2 で確定する):
//   record 参照 = Tiptap 公式の inline shortcode   [@ recordType="author" recordId="<id>" label="山田"]
//                 (@tiptap/extension-mention 自身が createInlineMarkdownSpec で同じ "@" 名の
//                  tokenizer を持つが nodeName が "mention" 固定なので、extend 後の名前で作り直す)
//   本文中画像  = 標準の画像構文で href を独自スキームに  ![ラベル](plyrs://asset/<id>)
//                 (image トークンは StarterKit が使わないので横取りできる。公式の
//                  createAtomBlockMarkdownSpec なら :::assetImage {…} 形式になる)
export const ASSET_IMAGE_HREF_PREFIX = "plyrs://asset/";

export const RecordMention = Mention.extend({
  name: RECORD_MENTION_NODE_TYPE,
  addAttributes() {
    return refAttributes;
  },
  ...createInlineMarkdownSpec({
    nodeName: RECORD_MENTION_NODE_TYPE,
    name: "@",
    selfClosing: true,
    allowedAttributes: ["recordType", "recordId", "label"],
  }),
}).configure({
  renderText({ node }) {
    return `@${attr(node, "label")}`;
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-type": RECORD_MENTION_NODE_TYPE,
        "data-record-type": attr(node, "recordType"),
        "data-record-id": attr(node, "recordId"),
        "data-label": attr(node, "label"),
      },
      `@${attr(node, "label")}`,
    ];
  },
  suggestion: { char: "@" },
});

export const AssetImage = Node.create({
  name: ASSET_IMAGE_NODE_TYPE,
  group: "block",
  atom: true,
  markdownTokenName: "image",
  parseMarkdown(token, helpers) {
    const href = typeof token["href"] === "string" ? token["href"] : "";
    if (!href.startsWith(ASSET_IMAGE_HREF_PREFIX)) {
      return [];
    }
    return helpers.createNode(ASSET_IMAGE_NODE_TYPE, {
      recordType: "asset",
      recordId: href.slice(ASSET_IMAGE_HREF_PREFIX.length),
      label: token["text"] ?? "",
    });
  },
  renderMarkdown(node) {
    const a = (node.attrs ?? {}) as Record<string, string>;
    return `![${a["label"] ?? ""}](${ASSET_IMAGE_HREF_PREFIX}${a["recordId"] ?? ""})`;
  },
  addAttributes() {
    return { ...refAttributes, recordType: { ...refAttributes.recordType, default: "asset" } };
  },
  parseHTML() {
    return [{ tag: `img[data-type="${ASSET_IMAGE_NODE_TYPE}"]` }];
  },
  renderHTML({ node }) {
    return [
      "img",
      {
        "data-type": ASSET_IMAGE_NODE_TYPE,
        "data-record-type": attr(node, "recordType"),
        "data-record-id": attr(node, "recordId"),
        "data-label": attr(node, "label"),
        alt: attr(node, "label"),
      },
    ];
  },
});

// Markdown 変換(@tiptap/markdown)は各拡張の renderMarkdown / parseMarkdown を見る。
// 標準語彙は StarterKit 側が持つ。独自ノードは試作では「HTML 断片としてそのまま埋める」
// 以外の表現が無いので、その挙動を観察する(= 不可逆箇所の候補)。
export function plyrsExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
    RecordMention,
    AssetImage,
  ];
}
