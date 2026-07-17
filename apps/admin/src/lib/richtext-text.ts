import {
  RECORD_MENTION_NODE_TYPE,
  type RichTextEnvelope,
  type RichTextNode,
} from "@plyrs/metamodel";

const DEFAULT_LIMIT = 120;

// 競合ダイアログの抜粋表示用: AST をプレーンテキストへ潰す(ノード間は空白 1 つ)。
export function richTextPlainText(value: RichTextEnvelope, limit = DEFAULT_LIMIT): string {
  const parts: string[] = [];
  const walk = (node: RichTextNode): void => {
    if (typeof node.text === "string" && node.text !== "") {
      parts.push(node.text);
    }
    if (node.type === RECORD_MENTION_NODE_TYPE) {
      const label = node.attrs?.["label"];
      parts.push(`@${typeof label === "string" ? label : "?"}`);
    }
    for (const child of node.content ?? []) {
      walk(child);
    }
  };
  walk(value.doc);
  const text = parts.join(" ").replaceAll(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}
