import type { FieldDefinition } from "@plyrs/metamodel";

// Phase 8 裁定 4: snapshotEmbed "value" の凍結埋め込み(asset 限定の固定語彙)。
// publish 時点の asset record から凍結し、以後 asset 側の変更には追従しない
// (L1: 埋め込むのは実質不変値のみ / L2: 古くなったら記事を再 publish — design-spec §7)。
export interface AssetEmbed {
  url: string;
  filename: string;
  contentType: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface ProjectionRelationRow {
  sourceField: string;
  targetType: string;
  targetId: string;
  ordinal: number;
  origin: string; // 'field' | 'body'
  // Phase 8 より前の snapshot の JSON には存在しないため optional。null = 凍結対象だったが
  // 参照先が dangling(素の ID 参照として投影される)。
  embed?: AssetEmbed | null;
}

export interface ProjectionIndexRow {
  fieldKey: string;
  valueText: string | null;
  valueNum: number | null;
  valueDate: string | null;
}

// Phase 5b: 公開 read API のフィールドカタログ（§12.4）。kind は projection_index の型別カラム
// （bool は value_num の 0/1）に対応し、'relation' は projected_relations を引く。multi=true は
// ソート不可（行分割で順序が未定義）。
export const CATALOG_KINDS = ["text", "num", "bool", "date", "relation"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

// Phase 5c housekeeping: projection_fields の kind は将来語彙が増えうる（record upsert への
// LWW 相乗り更新のため、旧コードが新 kind の行を読む窓がある）。未知 kind の行は
// 「宣言されていない」扱いで skip する保険（loadCatalog が使う）。
export function isCatalogKind(value: string): value is CatalogKind {
  return (CATALOG_KINDS as readonly string[]).includes(value);
}

export interface CatalogRow {
  fieldKey: string;
  kind: CatalogKind;
  multi: boolean;
}

// DO 内 published_snapshots 行のドメイン表現（design-spec §7）
export interface PublishedSnapshot {
  recordId: string;
  type: string;
  data: Record<string, unknown>;
  relations: ProjectionRelationRow[];
  publishedAt: string;
  publishedBy: string;
  sourceVersion: number; // どの records.version を publish したか（参考情報。順序トークンではない）
  publishSeq: number; // CRITICAL fix: 投影ジョブの順序ガード本体（DO 全体で単調な publish 世代番号）
}

// 投影 D1 の 3 テーブルへ書き込む全量（consumer はこれを D1 batch に落とすだけ）
export interface ProjectionPayload {
  recordId: string;
  type: string;
  slug: string | null;
  publishedAt: string;
  data: Record<string, unknown>;
  sourceVersion: number; // 参考情報として projected_records に書く（順序ガードには使わない）
  publishSeq: number; // CRITICAL fix: 投影ジョブの順序ガード本体
  relations: ProjectionRelationRow[];
  index: ProjectionIndexRow[];
  catalog: CatalogRow[]; // Phase 5b: 公開 read API のフィルタ/ソート検証用（型レベル情報）
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

// indexed 宣言済みスカラーと関係フィールドだけが載る。関係は projected_relations が常に全量
// 投影されるため宣言不要でフィルタ（メンバーシップ）可能。
export function catalogRowsForFields(fields: FieldDefinition[]): CatalogRow[] {
  const rows: CatalogRow[] = [];
  for (const field of fields) {
    switch (field.type) {
      case "text":
        if (field.config?.indexed === true) {
          rows.push({ fieldKey: field.key, kind: "text", multi: false });
        }
        break;
      case "number":
        if (field.config?.indexed === true) {
          rows.push({ fieldKey: field.key, kind: "num", multi: false });
        }
        break;
      case "boolean":
        if (field.config?.indexed === true) {
          rows.push({ fieldKey: field.key, kind: "bool", multi: false });
        }
        break;
      case "datetime":
        if (field.config?.indexed === true) {
          rows.push({ fieldKey: field.key, kind: "date", multi: false });
        }
        break;
      case "select":
        if (field.config.indexed === true) {
          rows.push({ fieldKey: field.key, kind: "text", multi: field.config.multiple === true });
        }
        break;
      case "relation":
        rows.push({
          fieldKey: field.key,
          kind: "relation",
          multi: field.config.cardinality === "many",
        });
        break;
      default:
        // json / richtext はフィルタ/ソート不可（indexed を構造的に持てない）
        break;
    }
  }
  return rows;
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
    publishSeq: snapshot.publishSeq,
    relations: snapshot.relations,
    index: fields.flatMap((field) => indexRowsForField(field, snapshot.data)),
    catalog: catalogRowsForFields(fields),
  };
}
