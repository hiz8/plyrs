import { z } from "zod";
import type { ContentTypeDefinition } from "./content-type";
import { uuidSchema } from "./ids";
import { richTextEnvelopeSchema, type RelationRef, type RichTextNode } from "./record-schema";

// 本文中の record 参照ノードの型名。packages/ui の RECORD_MENTION_NODE_NAME と一致する
// こと(apps/admin/src/lib/mention-contract.test.ts が両者の一致を固定する)。
export const RECORD_MENTION_NODE_TYPE = "recordMention";

// mention ノードの attrs 契約: { recordType, recordId, label }。label は挿入時点の表示名の
// スナップショット(エディタ表示専用 — relations には投影しない。真実源は参照先 record)。
const mentionAttrsSchema = z.looseObject({
  recordType: z.string().min(1),
  recordId: uuidSchema,
});

export interface BodyRelationWrite {
  fieldKey: string;
  refs: RelationRef[];
}

function collectMentionRefs(node: RichTextNode, refs: RelationRef[], seen: Set<string>): void {
  if (node.type === RECORD_MENTION_NODE_TYPE) {
    const attrs = mentionAttrsSchema.safeParse(node.attrs);
    if (attrs.success) {
      // 区切りは type key にも UUID にも現れない Unit Separator(エスケープ表記で書く)
      const key = `${attrs.data.recordType}${attrs.data.recordId}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ type: attrs.data.recordType, id: attrs.data.recordId });
      }
    }
  }
  for (const child of node.content ?? []) {
    collectMentionRefs(child, refs, seen);
  }
}

// design-spec §6「本文中リンクの一元化」: data(relation 分離後)の richtext フィールドを
// 走査し、record 参照ノードを relations(origin='body')への書き込みへ写す純関数。
// 防御的に読む: エンベロープ不成立・attrs 不正のフィールド/ノードは黙って読み飛ばす
// (古い形の data が残るのは常態 — design-spec §4.2)。同一参照の重複は文書内の初出のみ残す。
// 参照先の存在は保証しない(ソフト参照 — dangling は正常系)。
export function extractBodyRelations(
  contentType: ContentTypeDefinition,
  data: Record<string, unknown>,
): BodyRelationWrite[] {
  const writes: BodyRelationWrite[] = [];
  for (const field of contentType.fields) {
    if (field.type !== "richtext") {
      continue;
    }
    const parsed = richTextEnvelopeSchema.safeParse(data[field.key]);
    if (!parsed.success) {
      continue;
    }
    const refs: RelationRef[] = [];
    collectMentionRefs(parsed.data.doc, refs, new Set());
    if (refs.length > 0) {
      writes.push({ fieldKey: field.key, refs });
    }
  }
  return writes;
}
