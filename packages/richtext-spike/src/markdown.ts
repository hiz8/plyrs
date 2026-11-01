// Markdown ⇄ Tiptap JSON。公式の @tiptap/markdown 3.31.4(marked ベース)を Editor 無しで使う。
// Worker(DOM 無し)で動くかを確かめるため、この module は DOM API を一切参照しない。
import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { renderToMarkdown } from "@tiptap/static-renderer/pm/markdown";
import { plyrsExtensions } from "./extensions";

let manager: MarkdownManager | null = null;
function getManager(): MarkdownManager {
  manager ??= new MarkdownManager({ extensions: plyrsExtensions() });
  return manager;
}

/** AST → Markdown(@tiptap/markdown の serializer) */
export function toMarkdown(doc: JSONContent): string {
  return getManager().serialize(doc);
}

/** AST → Markdown(@tiptap/static-renderer の renderToMarkdown。比較用の第 2 経路) */
export function toMarkdownStatic(doc: JSONContent): string {
  return renderToMarkdown({ content: doc, extensions: plyrsExtensions() });
}

/** Markdown → AST */
export function fromMarkdown(markdown: string): JSONContent {
  return getManager().parse(markdown);
}
