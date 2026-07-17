import { ASSET_TYPE_KEY } from "@plyrs/metamodel";

// design-spec §6: relations は参照インデックスを兼ねる。orphan 検出(どこからも参照されない
// アセット)と安全な削除前の使用箇所表示は、この逆引き(idx_relations_target)で解く。
// origin は field / body の両方を数える(本文中の画像・mention も「使用」)。
export interface AssetUsageRow {
  sourceId: string;
  sourceType: string | null; // 参照元 record が消えた dangling 行では null(ソフト参照)
  sourceField: string;
  origin: string;
}

export function listAssetOrphanIds(sql: SqlStorage): string[] {
  return sql
    .exec<{ id: string }>(
      "SELECT id FROM records WHERE type = ? AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM relations WHERE target_type = ? AND target_id = records.id) ORDER BY id",
      ASSET_TYPE_KEY,
      ASSET_TYPE_KEY,
    )
    .toArray()
    .map((row) => row.id);
}

export function listAssetUsage(sql: SqlStorage, assetId: string): AssetUsageRow[] {
  return sql
    .exec<{ source_id: string; source_field: string; origin: string; source_type: string | null }>(
      "SELECT r.source_id, r.source_field, r.origin, rec.type AS source_type FROM relations r LEFT JOIN records rec ON rec.id = r.source_id WHERE r.target_type = ? AND r.target_id = ? ORDER BY r.source_id, r.source_field, r.ordinal",
      ASSET_TYPE_KEY,
      assetId,
    )
    .toArray()
    .map((row) => ({
      sourceId: row.source_id,
      sourceType: row.source_type,
      sourceField: row.source_field,
      origin: row.origin,
    }));
}
