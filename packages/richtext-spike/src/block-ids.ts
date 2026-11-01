// A1 (a) 案の核心: RICH_TEXT_SCHEMA_VERSION 1 のエンベロープを読むときに最上位ブロックへ
// ID を振る。ID はランダムにせず「ブロックの位置 + 内容」から決定的に導く(決定 44)。
//
// なぜ決定的でなければならないか: 未更新の record を読むたびに別の ID が出ると、エージェントが
// record_get で見たブロック ID を record_update のブロック操作に使っても「そのブロックは無い」
// になる。内容が変わっていなければ同じ ID が出るので、読み書きの間に内容が変わった場合は
// baseFieldVersions の不一致(strict なら conflict)で捕まり、整合する。
//
// この関数は純関数で、metamodel(クライアントと DO で共用)に置ける形にしている。
import type { RichTextEnvelope, RichTextNode } from "@plyrs/metamodel";

export const BLOCK_ID_ATTR = "id";
export const DERIVED_ID_PREFIX = "v1-";

// JSON.stringify はキー順に依存するため、キーを整列した正規形にしてからハッシュする。
// (ProseMirror の toJSON は attrs のキー順が拡張の登録順に依存しうる)
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

// FNV-1a 64bit を 2 系統(seed 違い)で回して 128bit 相当にする。同期(非 async)で、
// WebCrypto に依存しない(metamodel の純関数という制約に合わせる)。衝突耐性は
// 「同じ record 内の最上位ブロック同士(数十〜数百個)で区別できればよい」用途なので十分。
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

export function hashBlock(index: number, block: RichTextNode): string {
  // 位置を混ぜる: 同じ内容の段落が 2 つあっても別 ID になる
  const material = `${index}\u001f${canonicalJson(stripId(block))}`;
  const a = fnv1a64(material, 0xcbf29ce484222325n).toString(16).padStart(16, "0");
  const b = fnv1a64(material, 0x84222325cbf29ce4n).toString(16).padStart(16, "0");
  return `${DERIVED_ID_PREFIX}${a}${b.slice(0, 8)}`;
}

function stripId(block: RichTextNode): RichTextNode {
  if (block.attrs === undefined || !(BLOCK_ID_ATTR in block.attrs)) {
    return block;
  }
  const { [BLOCK_ID_ATTR]: _ignored, ...rest } = block.attrs;
  return Object.keys(rest).length === 0 ? { ...block, attrs: undefined } : { ...block, attrs: rest };
}

export interface BlockIdsResult {
  envelope: RichTextEnvelope;
  /** 読み時に導出した ID の数(永続化済みの ID は数えない) */
  derived: number;
}

// tolerant read の一部として呼ぶ。保存された ID(文字列)があればそれを優先し、無いブロック
// だけ導出する。永続化後(schemaVersion 2 で保存)は derived が 0 になる。
export function ensureTopLevelBlockIds(envelope: RichTextEnvelope): BlockIdsResult {
  const blocks = envelope.doc.content ?? [];
  let derived = 0;
  const seen = new Set<string>();
  const content = blocks.map((block, index) => {
    const existing = block.attrs?.[BLOCK_ID_ATTR];
    if (typeof existing === "string" && existing.length > 0 && !seen.has(existing)) {
      seen.add(existing);
      return block;
    }
    // 無い・空・重複(コピー&ペースト由来など)は導出で埋める
    derived++;
    const id = hashBlock(index, block);
    seen.add(id);
    return { ...block, attrs: { ...(block.attrs ?? {}), [BLOCK_ID_ATTR]: id } };
  });
  return { envelope: { ...envelope, doc: { ...envelope.doc, content } }, derived };
}
