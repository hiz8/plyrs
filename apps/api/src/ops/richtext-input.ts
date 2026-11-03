import {
  BLOCK_ID_ATTR,
  ensureTopLevelBlockIds,
  richTextEnvelopeSchema,
  type ContentTypeDefinition,
  type RichTextEnvelope,
  type RichTextNode,
} from "@plyrs/metamodel";
import { markdownToRichText } from "@plyrs/richtext";
import { z } from "zod";
import type { OpFailure } from "./read";

// design-spec 16.10(M4-1a): エージェント経路のリッチテキストの入力。record_create / record_update の
// input の richtext フィールドは 3 つの形を受ける:
//   1. ProseMirror のエンベロープ(従来。そのまま validate-on-write に渡す)
//   2. Markdown 文字列(全置換。@plyrs/richtext で AST に変換し、スキーマ検証を通す)
//   3. { blocks: BlockOp[] }(record_update のみ。現在の文書の最上位ブロックを ID で指す部分編集)
// ここで 1 の形に揃えてから既存の writeRecordCore に流す(DO の書き込み処理は増やさない。16.1)。
// 判定は型定義で行う(json フィールドに入った文字列や同じ形の値は触らない)。

export const MAX_BLOCK_OPS = 50;

export const blockOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("replace"),
    id: z.string().min(1).describe("置き換える最上位ブロックの ID(record_get の outline)"),
    markdown: z.string().describe("新しい内容の Markdown(複数ブロックでもよい)"),
  }),
  z.object({
    op: z.literal("insert"),
    after: z.string().min(1).nullable().describe("この ID のブロックの後ろに入れる。null なら先頭"),
    markdown: z.string(),
  }),
  z.object({ op: z.literal("delete"), id: z.string().min(1) }),
]);

export type BlockOp = z.infer<typeof blockOpSchema>;

const blockEditSchema = z.strictObject({
  blocks: z.array(blockOpSchema).min(1).max(MAX_BLOCK_OPS),
});

type Resolved = { ok: true; input: Record<string, unknown> } | OpFailure;
type FieldResolved = { ok: true; value: unknown } | OpFailure;

const EXTERNAL_IMAGE_HINT =
  "外部 URL の画像は asset_import_url で取り込み、返った assetId を ![label](plyrs://asset/<assetId>) で書く。";

function fromMarkdown(fieldKey: string, markdown: string): OpFailure | RichTextEnvelope {
  const converted = markdownToRichText(markdown);
  if (converted.ok) {
    return converted.envelope;
  }
  const hint = converted.unsupported.includes("external_image") ? ` ${EXTERNAL_IMAGE_HINT}` : "";
  return {
    ok: false,
    code: "unsupported_markdown",
    message: `${fieldKey}: ${converted.message}${hint}`,
    details: {
      field: fieldKey,
      kind: converted.unsupported[0],
      unsupported: converted.unsupported,
    },
  };
}

function isFailure(value: OpFailure | RichTextEnvelope): value is OpFailure {
  return "ok" in value && value.ok === false;
}

function idOf(block: RichTextNode): unknown {
  return block.attrs?.[BLOCK_ID_ATTR];
}

function withoutId(block: RichTextNode): RichTextNode {
  if (block.attrs === undefined || !(BLOCK_ID_ATTR in block.attrs)) {
    return block;
  }
  const { [BLOCK_ID_ATTR]: _id, ...rest } = block.attrs;
  return { ...block, attrs: rest };
}

function notFound(fieldKey: string, id: string): OpFailure {
  return {
    ok: false,
    code: "block_not_found",
    message: `${fieldKey}: block ${id} does not exist; re-read the record (record_get の outline)`,
    details: { field: fieldKey, id },
  };
}

// 現在の文書(ID は保存値か導出値。record_get で見たものと同じ)にブロック操作を順に当てる。
// replace の Markdown が 1 ブロックならそのブロックの ID を引き継ぐ。新しいブロックの ID は外しておき、
// 最後に ensureTopLevelBlockIds で位置から導出する(Markdown 側の導出 ID が既存の ID と衝突しないように)
function applyBlockOps(fieldKey: string, current: unknown, ops: readonly BlockOp[]): FieldResolved {
  const parsed = richTextEnvelopeSchema.safeParse(current);
  const base = parsed.success
    ? ensureTopLevelBlockIds(parsed.data).envelope
    : ensureTopLevelBlockIds({ schemaVersion: 1, doc: { type: "doc", content: [] } }).envelope;
  let blocks = [...(base.doc.content ?? [])];
  const indexOf = (id: string) => blocks.findIndex((block) => idOf(block) === id);
  for (const op of ops) {
    if (op.op === "delete") {
      const index = indexOf(op.id);
      if (index < 0) {
        return notFound(fieldKey, op.id);
      }
      blocks = blocks.toSpliced(index, 1);
      continue;
    }
    const converted = fromMarkdown(fieldKey, op.markdown);
    if (isFailure(converted)) {
      return converted;
    }
    const incoming = (converted.doc.content ?? []).map(withoutId);
    if (op.op === "replace") {
      const index = indexOf(op.id);
      if (index < 0) {
        return notFound(fieldKey, op.id);
      }
      const kept =
        incoming.length === 1 && incoming[0] !== undefined
          ? [{ ...incoming[0], attrs: { ...incoming[0].attrs, [BLOCK_ID_ATTR]: op.id } }]
          : incoming;
      blocks = blocks.toSpliced(index, 1, ...kept);
      continue;
    }
    if (op.after === null) {
      blocks = [...incoming, ...blocks];
      continue;
    }
    const index = indexOf(op.after);
    if (index < 0) {
      return notFound(fieldKey, op.after);
    }
    blocks = blocks.toSpliced(index + 1, 0, ...incoming);
  }
  const content = blocks.length === 0 ? [{ type: "paragraph" }] : blocks;
  return {
    ok: true,
    value: ensureTopLevelBlockIds({ ...base, doc: { ...base.doc, content } }).envelope,
  };
}

// input の richtext フィールドを ProseMirror のエンベロープに揃える。current は現在の input
// (record_create は null。ブロック操作は使えない)
export function resolveRichTextInputs(
  definition: Pick<ContentTypeDefinition, "fields">,
  input: Record<string, unknown>,
  current: Record<string, unknown> | null,
): Resolved {
  let next: Record<string, unknown> | null = null;
  for (const field of definition.fields) {
    if (field.type !== "richtext" || !(field.key in input)) {
      continue;
    }
    const value = input[field.key];
    let resolved: FieldResolved;
    if (typeof value === "string") {
      const converted = fromMarkdown(field.key, value);
      resolved = isFailure(converted) ? converted : { ok: true, value: converted };
    } else if (typeof value === "object" && value !== null && "blocks" in value) {
      if (current === null) {
        return {
          ok: false,
          code: "invalid_input",
          message: `${field.key}: blocks can only be used with record_update; send Markdown or a document`,
        };
      }
      const edit = blockEditSchema.safeParse(value);
      if (!edit.success) {
        return {
          ok: false,
          code: "invalid_input",
          message: `${field.key}: invalid block operations`,
          details: { issues: edit.error.issues },
        };
      }
      resolved = applyBlockOps(field.key, current[field.key], edit.data.blocks);
    } else {
      continue;
    }
    if (!resolved.ok) {
      return resolved;
    }
    next ??= { ...input };
    next[field.key] = resolved.value;
  }
  return { ok: true, input: next ?? input };
}
