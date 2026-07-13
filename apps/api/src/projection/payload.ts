import type { FieldDefinition } from "@plyrs/metamodel";

export interface ProjectionRelationRow {
  sourceField: string;
  targetType: string;
  targetId: string;
  ordinal: number;
  origin: string; // 'field' | 'body'
}

export interface ProjectionIndexRow {
  fieldKey: string;
  valueText: string | null;
  valueNum: number | null;
  valueDate: string | null;
}

// DO 内 published_snapshots 行のドメイン表現（design-spec §7）
export interface PublishedSnapshot {
  recordId: string;
  type: string;
  data: Record<string, unknown>;
  relations: ProjectionRelationRow[];
  publishedAt: string;
  publishedBy: string;
  sourceVersion: number;
}

// 投影 D1 の 3 テーブルへ書き込む全量（consumer はこれを D1 batch に落とすだけ）
export interface ProjectionPayload {
  recordId: string;
  type: string;
  slug: string | null;
  publishedAt: string;
  data: Record<string, unknown>;
  sourceVersion: number;
  relations: ProjectionRelationRow[];
  index: ProjectionIndexRow[];
}

// G4: 新しい宣言語彙を増やさず「key が 'slug' の unique な text フィールド」を実カラムへ昇格する
export function promoteSlug(
  fields: FieldDefinition[],
  data: Record<string, unknown>,
): string | null {
  const field = fields.find(
    (candidate) =>
      candidate.key === "slug" && candidate.type === "text" && candidate.config?.unique === true,
  );
  if (field === undefined) {
    return null;
  }
  const value = data["slug"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function row(fieldKey: string, part: Partial<ProjectionIndexRow>): ProjectionIndexRow {
  return { fieldKey, valueText: null, valueNum: null, valueDate: null, ...part };
}

// design-spec §12.2: 値は型別カラムに振り分ける（数値・日付を TEXT 一列で持つとソートが壊れる）。
// data は寛容読み（型定義とズレた値がありうる）なので、型が合わない値は索引に入れない。
function indexRowsForField(
  field: FieldDefinition,
  data: Record<string, unknown>,
): ProjectionIndexRow[] {
  const value = data[field.key];
  if (value === undefined || value === null) {
    return [];
  }
  switch (field.type) {
    case "text":
      return field.config?.indexed === true && typeof value === "string"
        ? [row(field.key, { valueText: value })]
        : [];
    case "number":
      return field.config?.indexed === true && typeof value === "number" && Number.isFinite(value)
        ? [row(field.key, { valueNum: value })]
        : [];
    case "boolean":
      return field.config?.indexed === true && typeof value === "boolean"
        ? [row(field.key, { valueNum: value ? 1 : 0 })]
        : [];
    case "datetime":
      return field.config?.indexed === true && typeof value === "string"
        ? [row(field.key, { valueDate: value })]
        : [];
    case "select": {
      if (field.config.indexed !== true) {
        return [];
      }
      // 複数選択の索引は 1 値 = 1 行（§12.4: フィルタは自然に any-of 意味論になる）
      if (field.config.multiple === true) {
        return Array.isArray(value)
          ? value
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => row(field.key, { valueText: entry }))
          : [];
      }
      return typeof value === "string" ? [row(field.key, { valueText: value })] : [];
    }
    default:
      // json / richtext / relation は indexed を持てない（metamodel が構造的に拒否する）
      return [];
  }
}

export function buildProjectionPayload(
  fields: FieldDefinition[],
  snapshot: PublishedSnapshot,
): ProjectionPayload {
  return {
    recordId: snapshot.recordId,
    type: snapshot.type,
    slug: promoteSlug(fields, snapshot.data),
    publishedAt: snapshot.publishedAt,
    data: snapshot.data,
    sourceVersion: snapshot.sourceVersion,
    relations: snapshot.relations,
    index: fields.flatMap((field) => indexRowsForField(field, snapshot.data)),
  };
}
