import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import {
  buildProjectionPayload,
  type AssetEmbed,
  type ProjectionPayload,
  type ProjectionRelationRow,
  type PublishedSnapshot,
} from "../projection/payload";
import { loadContentTypeByKey } from "./content-types";
import { enqueueOutbox } from "./outbox";
import type { RecordSnapshot } from "./types";
import { loadRecord } from "./write-record";

export interface PublishDeps {
  sql: SqlStorage;
  now: () => string;
  newId: () => string;
  // CRITICAL fix（レビュー指摘）: records.version は publish/unpublish で変化しないため投影ジョブの
  // 順序トークンになれない（unpublish→無編集republish が同じ version の upsert/delete を生む）。
  // publish・unpublish は必ずこれで新しい世代番号を採る。
  nextPublishSeq: () => number;
}

export type PublishResult =
  | { ok: true; snapshot: PublishedSnapshot }
  | { ok: false; code: "not_found" | "record_deleted" | "forbidden"; message: string };

export type UnpublishResult =
  | { ok: true; recordId: string; sourceVersion: number }
  | { ok: false; code: "not_published" | "forbidden"; message: string };

interface RawSnapshotRow extends Record<string, SqlStorageValue> {
  record_id: string;
  type: string;
  data: string;
  relations: string;
  published_at: string;
  published_by: string;
  source_version: number;
  publish_seq: number;
}

function rowToSnapshot(row: RawSnapshotRow): PublishedSnapshot {
  return {
    recordId: row.record_id,
    type: row.type,
    data: JSON.parse(row.data) as Record<string, unknown>,
    relations: JSON.parse(row.relations) as ProjectionRelationRow[],
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    sourceVersion: row.source_version,
    publishSeq: row.publish_seq,
  };
}

// publish 時点の関係を凍結投影する（field 由来も body 由来も両方。§7）
export function loadRelationRows(sql: SqlStorage, recordId: string): ProjectionRelationRow[] {
  return sql
    .exec<{
      source_field: string;
      target_type: string;
      target_id: string;
      ordinal: number;
      origin: string;
    }>(
      "SELECT source_field, target_type, target_id, ordinal, origin FROM relations WHERE source_id = ? ORDER BY source_field, origin, ordinal",
      recordId,
    )
    .toArray()
    .map((row) => ({
      sourceField: row.source_field,
      targetType: row.target_type,
      targetId: row.target_id,
      ordinal: row.ordinal,
      origin: row.origin,
    }));
}

// snapshot の作成 + outbox 投入(publish の物理部分)。カスケードでも記事本体でも同じ経路。
function writeSnapshot(
  deps: PublishDeps,
  record: RecordSnapshot,
  relations: ProjectionRelationRow[],
  actor: string,
): PublishedSnapshot {
  const now = deps.now();
  const publishSeq = deps.nextPublishSeq();
  const snapshot: PublishedSnapshot = {
    recordId: record.id,
    type: record.type,
    data: record.data,
    relations,
    publishedAt: now,
    publishedBy: actor,
    sourceVersion: record.version,
    publishSeq,
  };
  deps.sql.exec(
    "INSERT OR REPLACE INTO published_snapshots (record_id, type, data, relations, published_at, published_by, source_version, publish_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    snapshot.recordId,
    snapshot.type,
    JSON.stringify(snapshot.data),
    JSON.stringify(snapshot.relations),
    snapshot.publishedAt,
    snapshot.publishedBy,
    snapshot.sourceVersion,
    snapshot.publishSeq,
  );
  enqueueOutbox(
    deps.sql,
    deps.newId(),
    "upsert",
    record.id,
    snapshot.sourceVersion,
    snapshot.publishSeq,
    now,
  );
  return snapshot;
}

// Phase 8 裁定 4: 凍結埋め込みは publish 時点の asset record(編集の真実源)から読む。
// dangling(不在・削除済み・型違い)は null — 素の ID 参照として投影される(ソフト参照)。
function buildAssetEmbed(sql: SqlStorage, tenantSlug: string, assetId: string): AssetEmbed | null {
  const asset = loadRecord(sql, assetId);
  if (asset === null || asset.deletedAt !== null || asset.type !== ASSET_TYPE_KEY) {
    return null;
  }
  const data = asset.data;
  const str = (key: string): string | null => {
    const value = data[key];
    return typeof value === "string" ? value : null;
  };
  const num = (key: string): number | null => {
    const value = data[key];
    return typeof value === "number" ? value : null;
  };
  return {
    url: `/public/v1/${tenantSlug}/assets/${assetId}`,
    filename: str("filename") ?? "",
    contentType: str("content_type") ?? "application/octet-stream",
    alt: str("alt"),
    width: num("width"),
    height: num("height"),
  };
}

export function publishRecordCore(
  deps: PublishDeps,
  recordId: string,
  actor: string,
  tenantSlug: string,
): PublishResult {
  const record = loadRecord(deps.sql, recordId);
  if (record === null) {
    return { ok: false, code: "not_found", message: `record not found: ${recordId}` };
  }
  if (record.deletedAt !== null) {
    return { ok: false, code: "record_deleted", message: `record is deleted: ${recordId}` };
  }
  const relations = loadRelationRows(deps.sql, recordId);

  // Phase 8 裁定 7: 参照中(field + body)の未公開 asset を同一トランザクションで一緒に
  // publish する(公開ゲート付き配信の帰結 — 凍結 URL が publish 直後から機能するため)。
  // asset 自身は relation / richtext フィールドを持たないため再帰は起きない。
  // unpublish はカスケードしない(他の公開 record が参照中かもしれない)。
  const assetIds = [
    ...new Set(
      relations.filter((row) => row.targetType === ASSET_TYPE_KEY).map((row) => row.targetId),
    ),
  ];
  for (const assetId of assetIds) {
    if (assetId === recordId) {
      continue; // 自己参照の保険
    }
    const published = deps.sql
      .exec<{ record_id: string }>(
        "SELECT record_id FROM published_snapshots WHERE record_id = ?",
        assetId,
      )
      .toArray()[0];
    if (published !== undefined) {
      continue;
    }
    const asset = loadRecord(deps.sql, assetId);
    if (asset === null || asset.deletedAt !== null || asset.type !== ASSET_TYPE_KEY) {
      continue; // dangling は正常系(ソフト参照)
    }
    writeSnapshot(deps, asset, loadRelationRows(deps.sql, assetId), actor);
  }

  // 裁定 4: snapshotEmbed "value" のフィールド由来行へ凍結値を埋め込む。body 由来の asset
  // 参照には埋め込まない(フィールド設定を持たない — 公開側は URL 規約
  // /public/v1/:slug/assets/:id で解決する)。
  const contentType = loadContentTypeByKey(deps.sql, record.type);
  const embedFields = new Set<string>();
  for (const field of contentType?.fields ?? []) {
    if (field.type === "relation" && field.config.snapshotEmbed === "value") {
      embedFields.add(field.key);
    }
  }
  const frozen = relations.map((row) =>
    row.origin === "field" && embedFields.has(row.sourceField)
      ? { ...row, embed: buildAssetEmbed(deps.sql, tenantSlug, row.targetId) }
      : row,
  );
  return { ok: true, snapshot: writeSnapshot(deps, record, frozen, actor) };
}

export function unpublishRecordCore(deps: PublishDeps, recordId: string): UnpublishResult {
  const row = deps.sql
    .exec<{
      source_version: number;
    }>("SELECT source_version FROM published_snapshots WHERE record_id = ?", recordId)
    .toArray()[0];
  if (row === undefined) {
    return { ok: false, code: "not_published", message: `record is not published: ${recordId}` };
  }
  deps.sql.exec("DELETE FROM published_snapshots WHERE record_id = ?", recordId);
  // CRITICAL fix: delete ジョブには snapshot の publish_seq を使い回さず、必ず新しい世代番号を採る。
  // これにより「後から republish された upsert」は常にこの delete より新しい番号を持ち、
  // 遅れて届いた delete が republish 後の投影行を消せなくなる（§12.3）。
  const publishSeq = deps.nextPublishSeq();
  enqueueOutbox(
    deps.sql,
    deps.newId(),
    "delete",
    recordId,
    row.source_version,
    publishSeq,
    deps.now(),
  );
  return { ok: true, recordId, sourceVersion: row.source_version };
}

// 裁定（2026-07-13）: delete は unpublish を強制する。未公開なら何もしない。
export function cascadeUnpublish(deps: PublishDeps, recordId: string): void {
  unpublishRecordCore(deps, recordId);
}

export function loadProjectionPayload(sql: SqlStorage, recordId: string): ProjectionPayload | null {
  const row = sql
    .exec<RawSnapshotRow>("SELECT * FROM published_snapshots WHERE record_id = ?", recordId)
    .toArray()[0];
  if (row === undefined) {
    return null;
  }
  const snapshot = rowToSnapshot(row);
  // 型定義が消えていても投影は落とさない（索引が空になるだけ）。寛容読みの姿勢と揃える。
  const contentType = loadContentTypeByKey(sql, snapshot.type);
  return buildProjectionPayload(contentType?.fields ?? [], snapshot);
}

// 再投影のページング（record_id 順の keyset ページネーション）
export function loadPublishedPage(
  sql: SqlStorage,
  cursor: string | null,
  limit: number,
): { payloads: ProjectionPayload[]; nextCursor: string | null } {
  const rows =
    cursor === null
      ? sql
          .exec<RawSnapshotRow>(
            "SELECT * FROM published_snapshots ORDER BY record_id LIMIT ?",
            limit,
          )
          .toArray()
      : sql
          .exec<RawSnapshotRow>(
            "SELECT * FROM published_snapshots WHERE record_id > ? ORDER BY record_id LIMIT ?",
            cursor,
            limit,
          )
          .toArray();
  const payloads = rows.map((row) => {
    const snapshot = rowToSnapshot(row);
    const contentType = loadContentTypeByKey(sql, snapshot.type);
    return buildProjectionPayload(contentType?.fields ?? [], snapshot);
  });
  const last = payloads[payloads.length - 1];
  const nextCursor = payloads.length === limit && last !== undefined ? last.recordId : null;
  return { payloads, nextCursor };
}

// Phase 6b: 管理画面の公開状態表示・archive 警告（design-spec §7）のための読み取り。
// 公開状態の真実源 = published_snapshots 行の有無（§7）なので、record の存在は見ない。
export type PublicationState =
  | { published: false }
  | { published: true; publishedAt: string; publishedBy: string; sourceVersion: number };

export function loadPublicationState(sql: SqlStorage, recordId: string): PublicationState {
  const row = sql
    .exec<{ published_at: string; published_by: string; source_version: number }>(
      "SELECT published_at, published_by, source_version FROM published_snapshots WHERE record_id = ?",
      recordId,
    )
    .toArray()[0];
  return row === undefined
    ? { published: false }
    : {
        published: true,
        publishedAt: row.published_at,
        publishedBy: row.published_by,
        sourceVersion: row.source_version,
      };
}
