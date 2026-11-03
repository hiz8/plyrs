import {
  RECORD_MENTION_NODE_TYPE,
  type RichTextEnvelope,
  type RichTextNode,
} from "@plyrs/metamodel";

// AST をプレーンテキストへ潰す(ノード間は空白 1 つ)。管理画面の抜粋表示(競合ダイアログ・一覧)と、
// 全文検索の索引(M2-9)が共用する。limit を省くと切らない
export function richTextPlainText(value: RichTextEnvelope, limit?: number): string {
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
  return limit === undefined || text.length <= limit ? text : `${text.slice(0, limit)}…`;
}
