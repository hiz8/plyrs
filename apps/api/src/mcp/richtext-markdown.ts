import {
  ASSET_IMAGE_NODE_TYPE,
  RECORD_MENTION_NODE_TYPE,
  type RichTextEnvelope,
} from "@plyrs/metamodel";
import { createInlineMarkdownSpec, Node } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

// M1-6(論点 E1 / M0-2 結果 3 節): リッチテキスト(Tiptap JSON)→ Markdown の一方向変換。
// `@tiptap/markdown` の MarkdownManager を Editor 無し(DOM 無し)で使う。拡張の集合は ui の
// エディタ(packages/ui/src/rich-text-editor.tsx の useEditor に並ぶもの)と同じ語彙:
// StarterKit(heading 1〜3・link)+ recordMention + assetImage。ui 側は React / suggestion
// 依存なので、まずは api 側に Markdown 用の最小定義を複製し、M2-2 で metamodel 側へ寄せて共有する。
// Markdown → JSON(逆方向)は M2-2 で扱う(スキーマ検証を伴う)。

function stringAttr(node: { attrs?: Record<string, unknown> | undefined }, name: string): string {
  return String(node.attrs?.[name] ?? "");
}

const ATTRIBUTES = {
  recordType: { default: "" },
  recordId: { default: "" },
  label: { default: "" },
};

// record 参照: Tiptap 公式の inline shortcode `[@ recordType="author" recordId="<uuid>" label="山田"]`
// (@tiptap/extension-mention と同じ tokenizer だが nodeName が違うので作り直す)
const recordMentionMarkdown = Node.create({
  name: RECORD_MENTION_NODE_TYPE,
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return ATTRIBUTES;
  },
  ...createInlineMarkdownSpec({
    nodeName: RECORD_MENTION_NODE_TYPE,
    name: "@",
    selfClosing: true,
    allowedAttributes: ["recordType", "recordId", "label"],
  }),
});

// 本文中画像: 標準の画像構文で href を独自スキームに `![hero.png](plyrs://asset/<uuid>)`
const assetImageMarkdown = Node.create({
  name: ASSET_IMAGE_NODE_TYPE,
  group: "block",
  atom: true,
  addAttributes() {
    return { ...ATTRIBUTES, recordType: { default: "asset" } };
  },
  renderMarkdown(node) {
    return `![${stringAttr(node, "label")}](plyrs://asset/${stringAttr(node, "recordId")})`;
  },
});

let manager: MarkdownManager | null = null;

function getManager(): MarkdownManager {
  manager ??= new MarkdownManager({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      recordMentionMarkdown,
      assetImageMarkdown,
    ],
  });
  return manager;
}

export function richTextToMarkdown(envelope: RichTextEnvelope): string {
  return getManager().serialize(envelope.doc).trim();
}
