import {
  ensureTopLevelBlockIds,
  richTextEnvelopeSchema,
  type RichTextEnvelope,
  type RichTextNode,
} from "@plyrs/metamodel";
import { getSchema, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Schema } from "@tiptap/pm/model";
import { workerExtensions } from "./extensions";
import { MAX_HEADING_LEVEL } from "./vocabulary";

// M2-2(design-spec 16.10、決定 46): Markdown ⇄ AST の双方向変換。@tiptap/markdown の
// MarkdownManager を Editor 無し・DOM 無しで使う(M0-2 試作で確認、workerd での動作は
// apps/api/test/richtext-workerd.test.ts が固定)。Markdown → AST は必ず ProseMirror の
// スキーマ検証を通し、語彙に無い構造(表・タスクリスト・外部 URL の画像)は業務エラーで返す。

export type UnsupportedMarkdownKind =
  | "table"
  | "task_list"
  | "external_image"
  | "invalid_structure";

export type MarkdownToRichTextResult =
  | { ok: true; envelope: RichTextEnvelope }
  | {
      ok: false;
      code: "unsupported_markdown";
      message: string;
      unsupported: UnsupportedMarkdownKind[];
    };

let manager: MarkdownManager | null = null;
let schema: Schema | null = null;

function getManager(): MarkdownManager {
  manager ??= new MarkdownManager({ extensions: workerExtensions() });
  return manager;
}

function getPmSchema(): Schema {
  schema ??= getSchema(workerExtensions());
  return schema;
}

export function richTextToMarkdown(envelope: RichTextEnvelope): string {
  // serialize は末尾に改行を足さず、段落先頭・末尾の空白も保つ(trim すると往復が壊れる)
  return getManager().serialize(envelope.doc as JSONContent);
}

const EMPTY_DOC: RichTextNode = { type: "doc", content: [{ type: "paragraph" }] };

// parse の前に正規表現で検出する構文。marked は表やタスクリストを黙って落とす・不正な AST にする
// (M0-2 結果 4 節)ので、何が使えなかったかを人とエージェントに伝えるためにここで名前を付ける
const TABLE_ROW = /^\s*\|.*\|\s*$/u;
const TASK_ITEM = /^\s*(?:[-*+]|\d+\.)\s+\[(?: |x|X)\]\s/u;
const IMAGE = /!\[[^\]]*\]\(\s*([^)\s]+)/gu;

function detectUnsupported(markdown: string): UnsupportedMarkdownKind[] {
  const found = new Set<UnsupportedMarkdownKind>();
  const lines = markdown.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (TABLE_ROW.test(line) && TABLE_ROW.test(lines[i + 1] ?? "")) {
      found.add("table");
    }
    if (TASK_ITEM.test(line)) {
      found.add("task_list");
    }
  }
  for (const match of markdown.matchAll(IMAGE)) {
    if (!(match[1] ?? "").startsWith("plyrs://asset/")) {
      found.add("external_image");
    }
  }
  return [...found];
}

// 見出し 4〜6 は語彙に無い(エディタは 1〜3)。拒否せず 3 に丸める(M0-2 結果 4 節の仮置きを採用)
function clampHeadings(node: JSONContent): JSONContent {
  const content = node.content?.map(clampHeadings);
  if (node.type === "heading") {
    const level = Number(node.attrs?.["level"] ?? 1);
    return {
      ...node,
      attrs: { ...node.attrs, level: Math.min(level, MAX_HEADING_LEVEL) },
      ...(content === undefined ? {} : { content }),
    };
  }
  return content === undefined ? node : { ...node, content };
}

const UNSUPPORTED_LABEL: Record<UnsupportedMarkdownKind, string> = {
  table: "表(GFM テーブル)",
  task_list: "タスクリスト(- [ ])",
  external_image: "外部 URL の画像(本文中画像は plyrs://asset/<id> だけ)",
  invalid_structure: "語彙に無い構造",
};

function unsupported(
  kinds: UnsupportedMarkdownKind[],
  detail?: string,
): Extract<MarkdownToRichTextResult, { ok: false }> {
  const names = kinds.map((kind) => UNSUPPORTED_LABEL[kind]).join("、");
  return {
    ok: false,
    code: "unsupported_markdown",
    message: `Markdown に語彙外の構文が含まれている: ${names}${detail === undefined ? "" : `(${detail})`}`,
    unsupported: kinds,
  };
}

export function markdownToRichText(markdown: string): MarkdownToRichTextResult {
  if (markdown.trim() === "") {
    const { envelope } = ensureTopLevelBlockIds({ schemaVersion: 1, doc: EMPTY_DOC });
    return { ok: true, envelope };
  }
  const detected = detectUnsupported(markdown);
  if (detected.length > 0) {
    return unsupported(detected);
  }
  const parsed = clampHeadings(getManager().parse(markdown));
  const doc = parsed.content === undefined || parsed.content.length === 0 ? EMPTY_DOC : parsed;
  let checked: JSONContent;
  try {
    const node = getPmSchema().nodeFromJSON(doc);
    node.check();
    checked = node.toJSON() as JSONContent;
  } catch (error) {
    return unsupported(
      ["invalid_structure"],
      error instanceof Error ? error.message : String(error),
    );
  }
  const envelope = richTextEnvelopeSchema.safeParse({ schemaVersion: 1, doc: checked });
  if (!envelope.success) {
    return unsupported(["invalid_structure"], "envelope");
  }
  return { ok: true, envelope: ensureTopLevelBlockIds(envelope.data).envelope };
}

// 変換結果の比較や保存前の確認に使う: ProseMirror のスキーマで検証し、通らなければ理由を返す
export function checkRichText(
  envelope: RichTextEnvelope,
): { ok: true } | { ok: false; message: string } {
  try {
    getPmSchema()
      .nodeFromJSON(envelope.doc as JSONContent)
      .check();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
