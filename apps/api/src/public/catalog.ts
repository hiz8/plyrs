import { isCatalogKind, type CatalogKind } from "../projection/payload";

// projection_fields（Phase 5b で追加したフィールドカタログ表）を Map へロードする。
// 公開 read API がフィルタ/ソート/include の検証と型別カラムの選択に使う。
export interface CatalogEntry {
  kind: CatalogKind;
  multi: boolean;
}

export type Catalog = Map<string, CatalogEntry>;

export async function loadCatalog(
  db: D1Database,
  tenantId: string,
  type: string,
): Promise<Catalog> {
  const { results } = await db
    .prepare(
      "SELECT field_key, kind, multi FROM projection_fields WHERE tenant_id = ?1 AND type = ?2",
    )
    .bind(tenantId, type)
    .all<{ field_key: string; kind: string; multi: number }>();
  const catalog: Catalog = new Map();
  for (const row of results) {
    // Phase 5c: 未知 kind は「宣言されていない」扱いで skip（無検査 cast の除去も兼ねる）
    if (!isCatalogKind(row.kind)) {
      continue;
    }
    catalog.set(row.field_key, { kind: row.kind, multi: row.multi === 1 });
  }
  return catalog;
}
