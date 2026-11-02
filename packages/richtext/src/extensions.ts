import { ASSET_IMAGE_NODE_TYPE, RECORD_MENTION_NODE_TYPE } from "@plyrs/metamodel";
import { createInlineMarkdownSpec, Node, type AnyExtension } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import StarterKit from "@tiptap/starter-kit";
import {
  ASSET_IMAGE_HREF_PREFIX,
  HEADING_LEVELS,
  RECORD_MENTION_MARKDOWN_NAME,
  REF_ATTRIBUTE_NAMES,
} from "./vocabulary";

// Worker / DO 側(DOM 無し・React 無し)で使う拡張集合。ui のエディタ(packages/ui の useEditor に
// 並ぶ StarterKit + recordMention + assetImage)と同じ語彙を、表示(nodeView・suggestion)を
// 持たない形で再現する。Markdown の parse / serialize とスキーマ検証はこの集合で行う。

function attr(node: { attrs?: Record<string, unknown> | undefined }, name: string): string {
  return String(node.attrs?.[name] ?? "");
}

const refAttributes = {
  recordType: { default: "" },
  recordId: { default: "" },
  label: { default: "" },
};

// record 参照。@tiptap/extension-mention 自身が同じ "@" の tokenizer を持つが nodeName が
// "mention" 固定なので、extend 後の名前で createInlineMarkdownSpec を作り直す
export const RecordMention = Mention.extend({
  name: RECORD_MENTION_NODE_TYPE,
  addAttributes() {
    return refAttributes;
  },
  ...createInlineMarkdownSpec({
    nodeName: RECORD_MENTION_NODE_TYPE,
    name: RECORD_MENTION_MARKDOWN_NAME,
    selfClosing: true,
    allowedAttributes: [...REF_ATTRIBUTE_NAMES],
  }),
}).configure({
  renderText({ node }) {
    return `@${attr(node, "label")}`;
  },
  suggestion: { char: "@" },
});

// 本文中画像。標準の画像構文の href を独自スキームにする(image トークンは StarterKit が使わない
// ので横取りできる)。外部 URL の画像は語彙に無いので受け付けない(アセット取り込みは M4-5)。
// parseMarkdown で落とす前に markdown.ts が正規表現で検出して unsupported_markdown にする
export const AssetImage = Node.create({
  name: ASSET_IMAGE_NODE_TYPE,
  group: "block",
  atom: true,
  markdownTokenName: "image",
  addAttributes() {
    return { ...refAttributes, recordType: { default: "asset" } };
  },
  parseMarkdown(token, helpers) {
    const href = typeof token["href"] === "string" ? token["href"] : "";
    if (!href.startsWith(ASSET_IMAGE_HREF_PREFIX)) {
      return [];
    }
    return helpers.createNode(ASSET_IMAGE_NODE_TYPE, {
      recordType: "asset",
      recordId: href.slice(ASSET_IMAGE_HREF_PREFIX.length),
      label: typeof token["text"] === "string" ? token["text"] : "",
    });
  },
  renderMarkdown(node) {
    return `![${attr(node, "label")}](${ASSET_IMAGE_HREF_PREFIX}${attr(node, "recordId")})`;
  },
});

export function workerExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [...HEADING_LEVELS] },
      link: { openOnClick: false },
    }),
    RecordMention,
    AssetImage,
  ];
}
