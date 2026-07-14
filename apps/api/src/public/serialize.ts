// 裁定（2026-07-14）: 内部値（source_version / publish_seq / projected_at）は公開しない。
// ユーザー定義フィールドは fields に入れ子（システム項目との名前衝突を構造で回避）。
export interface PublicRecord {
  id: string;
  type: string;
  slug: string | null;
  publishedAt: string;
  fields: Record<string, unknown>;
}

export interface ProjectedRecordRow {
  record_id: string;
  type: string;
  slug: string | null;
  published_at: string;
  data: string;
}

export function toPublicRecord(row: ProjectedRecordRow): PublicRecord {
  return {
    id: row.record_id,
    type: row.type,
    slug: row.slug,
    publishedAt: row.published_at,
    fields: JSON.parse(row.data) as Record<string, unknown>,
  };
}
