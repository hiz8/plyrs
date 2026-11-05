import type { ContentTypeDefinition } from "./content-type";
import { richTextEnvelopeSchema, type RichTextEnvelope, type RichTextNode } from "./record-schema";

// design-spec 16.10 / 決定 44・46(M2-1): リッチテキストの最上位ブロックに安定 ID を付ける。
// 形式は ProseMirror JSON のまま、各最上位ブロックの attrs.id。schemaVersion 2 がこの契約の版。
//
// v1(ID 無し)を読むときの ID はランダムにせず「ブロックの位置 + 内容」から決定的に導く。
// 未更新の record を読むたびに別の ID が出ると、エージェントが record_get で見た ID を
// record_update のブロック操作に使っても「そのブロックは無い」になるため。内容が変わっていれば
// ID も変わるが、その場合は baseFieldVersions の不一致で捕まり整合する。永続化後(次の書き込み)は
// 保存された ID を優先する。一括変換はしない(§4.2 の遅延マイグレーション)。
//
// 契約は最上位ブロックだけ。入れ子のノードに ID があっても害は無いが、ここでは触らない
// (M0-2 結果 2 節)。純関数で、クライアント(エディタへ渡す前)と DO(書き込み・record_get)で共用する。

export const RICH_TEXT_SCHEMA_VERSION = 2;
export const BLOCK_ID_ATTR = "id";
export const DERIVED_ID_PREFIX = "v1-";

// 管理画面のエディタ(UniqueID)が attrs.id を付けるノード種。契約は最上位ブロックだけだが、types は
// ノード種の指定なので箇条書きの中の段落にも付く。ui は metamodel に依存しないので同じ値を写して持ち、
// 一致は apps/admin/src/lib/mention-contract.test.ts が固定する。書き込み時の構造の検査(M5a-6)は、
// この種類のノードにだけ attrs.id を許す
export const BLOCK_ID_NODE_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "assetImage",
] as const;

// JSON.stringify はキー順に依存するため、キーを整列した正規形にしてからハッシュする
// (ProseMirror の toJSON は attrs のキー順が拡張の登録順に依存しうる)。undefined の値は省く。
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// FNV-1a 64bit を 2 系統(seed 違い)で回して 96bit 分を使う。同期(非 async)で WebCrypto に
// 依存しない。衝突耐性は「同じ record 内の最上位ブロック同士(数十〜数百個)を区別できればよい」
// 用途なので十分。
function fnv1a64(input: string, seed: bigint): bigint {
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash;
}

function stripId(block: RichTextNode): RichTextNode {
  if (block.attrs === undefined || !(BLOCK_ID_ATTR in block.attrs)) {
    return block;
  }
  const { [BLOCK_ID_ATTR]: _ignored, ...rest } = block.attrs;
  return Object.keys(rest).length === 0
    ? { ...block, attrs: undefined }
    : { ...block, attrs: rest };
}

export function hashBlock(index: number, block: RichTextNode): string {
  // 位置を混ぜる: 同じ内容の段落が 2 つあっても別 ID になる
  const material = `${index}\u001f${canonicalJson(stripId(block))}`;
  const a = fnv1a64(material, 0xcbf29ce484222325n).toString(16).padStart(16, "0");
  const b = fnv1a64(material, 0x84222325cbf29ce4n).toString(16).padStart(16, "0");
  return `${DERIVED_ID_PREFIX}${a}${b.slice(0, 8)}`;
}

export interface BlockIdsResult {
  envelope: RichTextEnvelope;
  // 書き直したか。false なら envelope は入力と同じ参照(呼び出し側は何も書かなくてよい)
  changed: boolean;
}

// 保存された ID(空でない文字列、重複していない)があればそれを優先し、無い・空・重複
// (コピー&ペースト由来など)のブロックだけ導出する。導出 ID が保存済みの ID と重なれば接尾辞 -2, -3… を付ける。版が 2 未満なら 2 に上げる。
export function ensureTopLevelBlockIds(envelope: RichTextEnvelope): BlockIdsResult {
  const blocks = envelope.doc.content ?? [];
  let changed = envelope.schemaVersion < RICH_TEXT_SCHEMA_VERSION;
  // 先に保存された ID を全部押さえる(最初の出現が持ち主)。導出 ID がそれと重なっても、後ろにある
  // 保存済みのブロックから ID を奪わない(先頭に同じ内容のブロックを入れた場合など)
  const keeps = blocks.map(() => false);
  const seen = new Set<string>();
  blocks.forEach((block, index) => {
    const existing = block.attrs?.[BLOCK_ID_ATTR];
    if (typeof existing === "string" && existing.length > 0 && !seen.has(existing)) {
      seen.add(existing);
      keeps[index] = true;
    }
  });
  const content = blocks.map((block, index) => {
    if (keeps[index] === true) {
      return block;
    }
    changed = true;
    const base = hashBlock(index, block);
    let id = base;
    for (let n = 2; seen.has(id); n++) {
      id = `${base}-${n}`;
    }
    seen.add(id);
    return { ...block, attrs: { ...block.attrs, [BLOCK_ID_ATTR]: id } };
  });
  if (!changed) {
    return { envelope, changed: false };
  }
  return {
    envelope: {
      ...envelope,
      schemaVersion: Math.max(envelope.schemaVersion, RICH_TEXT_SCHEMA_VERSION),
      doc: { ...envelope.doc, content },
    },
    changed: true,
  };
}

export interface RecordBlockIdsResult {
  data: Record<string, unknown>;
  changed: boolean;
}

// record の data のうち richtext フィールド(型定義で判定。json フィールドに同じ形の値が入っても
// 触らない)に ensureTopLevelBlockIds を適用する。エンベロープとして解釈できない値は触らない
// (古い形の data が残るのは常態 — §4.2 の tolerant read と同じ姿勢)。
export function ensureRecordBlockIds(
  definition: Pick<ContentTypeDefinition, "fields">,
  data: Record<string, unknown>,
): RecordBlockIdsResult {
  let next: Record<string, unknown> | null = null;
  for (const field of definition.fields) {
    if (field.type !== "richtext") {
      continue;
    }
    const parsed = richTextEnvelopeSchema.safeParse(data[field.key]);
    if (!parsed.success) {
      continue;
    }
    const result = ensureTopLevelBlockIds(parsed.data);
    if (result.changed) {
      next ??= { ...data };
      next[field.key] = result.envelope;
    }
  }
  return next === null ? { data, changed: false } : { data: next, changed: true };
}
