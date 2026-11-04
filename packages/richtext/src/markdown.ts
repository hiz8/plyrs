import {
  BLOCK_ID_ATTR,
  BLOCK_ID_NODE_TYPES,
  ensureTopLevelBlockIds,
  richTextEnvelopeSchema,
  type RichTextEnvelope,
  type RichTextNode,
} from "@plyrs/metamodel";
import { getSchema, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Schema } from "@tiptap/pm/model";
import { workerExtensions } from "./extensions";
import {
  ASSET_IMAGE_HREF_PREFIX,
  MAX_HEADING_LEVEL,
  UnsupportedMarkdownError,
  type UnsupportedMarkdownKind,
} from "./vocabulary";

// M2-2(design-spec 16.10、決定 46): Markdown ⇄ AST の双方向変換。@tiptap/markdown の
// MarkdownManager を Editor 無し・DOM 無しで使う(M0-2 試作で確認、workerd での動作は
// apps/api/test/richtext-workerd.test.ts が固定)。Markdown → AST は必ず ProseMirror の
// スキーマ検証を通し、語彙に無い構造(表・タスクリスト・外部 URL の画像)は業務エラーで返す。

export type { UnsupportedMarkdownKind } from "./vocabulary";

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

// Worker 側のスキーマ(管理画面のエディタとの語彙の一致を apps/admin の mention-contract.test.ts が固定する)
export function richTextSchema(): Schema {
  return getPmSchema();
}

export function richTextToMarkdown(envelope: RichTextEnvelope): string {
  // serialize は末尾に改行を足さず、段落先頭・末尾の空白も保つ(trim すると往復が壊れる)
  return getManager().serialize(envelope.doc as JSONContent);
}

const EMPTY_DOC: RichTextNode = { type: "doc", content: [{ type: "paragraph" }] };

// parse の前に marked のトークンを走査して検出する構文。marked は表やタスクリストを黙って落とす・
// 不正な AST にする(M0-2 結果 4 節)ので、何が使えなかったかを人とエージェントに伝えるためにここで
// 名前を付ける。正規表現で行を見ると、行頭・行末の `|` を省いた GFM テーブルを見逃し、コードブロック内の
// `| a |` や `- [ ]` を誤検出するので、marked 自身の字句解析に揃える
interface MarkedToken {
  type?: string;
  href?: unknown;
  task?: boolean;
  tokens?: MarkedToken[];
  items?: MarkedToken[];
  header?: MarkedToken[];
  rows?: MarkedToken[][];
}

function* walkTokens(tokens: readonly MarkedToken[]): Generator<MarkedToken> {
  for (const token of tokens) {
    yield token;
    if (token.tokens !== undefined) yield* walkTokens(token.tokens);
    if (token.items !== undefined) yield* walkTokens(token.items);
  }
}

function detectUnsupported(markdown: string): UnsupportedMarkdownKind[] {
  const found = new Set<UnsupportedMarkdownKind>();
  const tokens = getManager().instance.lexer(markdown) as unknown as MarkedToken[];
  for (const token of walkTokens(tokens)) {
    if (token.type === "table") {
      found.add("table");
    } else if (token.type === "list_item" && token.task === true) {
      found.add("task_list");
    } else if (token.type === "image") {
      const href = typeof token.href === "string" ? token.href : "";
      if (!href.startsWith(ASSET_IMAGE_HREF_PREFIX)) {
        found.add("external_image");
      }
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
  let parsed: JSONContent;
  try {
    parsed = clampHeadings(getManager().parse(markdown));
  } catch (error) {
    if (error instanceof UnsupportedMarkdownError) {
      return unsupported([error.kind], error.message);
    }
    throw error;
  }
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

const BLOCK_ID_TYPES: ReadonlySet<string> = new Set(BLOCK_ID_NODE_TYPES);

interface JsonNode {
  type?: unknown;
  attrs?: unknown;
  marks?: unknown;
  content?: unknown;
}

function allowedAttrs(spec: { attrs?: Record<string, unknown> | null } | undefined): Set<string> {
  return new Set(Object.keys(spec?.attrs ?? {}));
}

// M5a-6: 語彙の検査。語彙に無いノード・マークと、既知のノード・マークの余分な属性を見る(ProseMirror の
// nodeFromJSON は余分な属性を黙って捨てるので、ここで見る)。許す属性はスキーマの属性と、ブロック ID の
// 付くノード種の attrs.id だけ。内容の規則(doc は 1 つ以上のブロック、など)はここでは見ない
function vocabularyErrorIn(schema: Schema, node: JsonNode, path: string): string | null {
  const type = typeof node.type === "string" ? node.type : "";
  const nodeType = schema.nodes[type];
  if (nodeType === undefined) {
    return `${path}: unknown node type ${JSON.stringify(type).slice(0, 40)}`;
  }
  if (node.attrs !== undefined && node.attrs !== null) {
    if (typeof node.attrs !== "object" || Array.isArray(node.attrs)) {
      return `${path}: attrs of ${type} must be an object`;
    }
    const allowed = allowedAttrs(nodeType.spec);
    if (BLOCK_ID_TYPES.has(type)) {
      allowed.add(BLOCK_ID_ATTR);
    }
    const extra = Object.keys(node.attrs).filter((key) => !allowed.has(key));
    if (extra.length > 0) {
      return `${path}: unknown attribute ${extra.join(", ")} on ${type}`;
    }
  }
  if (Array.isArray(node.marks)) {
    for (const mark of node.marks as JsonNode[]) {
      const markType = typeof mark?.type === "string" ? schema.marks[mark.type] : undefined;
      if (markType === undefined) {
        return `${path}: unknown mark type ${JSON.stringify(mark?.type ?? null).slice(0, 40)}`;
      }
      if (mark.attrs === undefined || mark.attrs === null) {
        continue;
      }
      if (typeof mark.attrs !== "object" || Array.isArray(mark.attrs)) {
        return `${path}: attrs of mark ${String(mark.type)} must be an object`;
      }
      const allowed = allowedAttrs(markType.spec);
      const extra = Object.keys(mark.attrs).filter((key) => !allowed.has(key));
      if (extra.length > 0) {
        return `${path}: unknown attribute ${extra.join(", ")} on mark ${String(mark.type)}`;
      }
    }
  }
  if (Array.isArray(node.content)) {
    for (const [index, child] of (node.content as JsonNode[]).entries()) {
      if (child === null || typeof child !== "object" || Array.isArray(child)) {
        return `${path}.content[${index}]: a node must be an object`;
      }
      const found = vocabularyErrorIn(schema, child, `${path}.content[${index}]`);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

// M5a-6(16.10): 書き込み時の構造の検査(validate-on-write)。語彙と属性だけを見て、内容の規則は見ない
// (空の doc など、管理画面や既存の値が作る形を拒否しない)
export function checkRichTextVocabulary(
  envelope: RichTextEnvelope,
): { ok: true } | { ok: false; message: string } {
  const error = vocabularyErrorIn(getPmSchema(), envelope.doc as JsonNode, "doc");
  return error === null ? { ok: true } : { ok: false, message: error };
}

// 変換結果の比較や保存前の確認に使う: ProseMirror のスキーマで検証し(内容の規則を含む)、語彙と属性も
// 見る。通らなければ理由を返す
export function checkRichText(
  envelope: RichTextEnvelope,
): { ok: true } | { ok: false; message: string } {
  try {
    getPmSchema()
      .nodeFromJSON(envelope.doc as JSONContent)
      .check();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  return checkRichTextVocabulary(envelope);
}
