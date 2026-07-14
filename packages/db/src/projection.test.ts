import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  projectedRecords,
  projectedRelations,
  projectionFields,
  projectionIndex,
  projectionTombstones,
} from "./projection";

describe("@plyrs/db projection schema", () => {
  it("defines the three projection tables from design-spec §12.2", () => {
    expect(getTableName(projectedRecords)).toBe("projected_records");
    expect(getTableName(projectedRelations)).toBe("projected_relations");
    expect(getTableName(projectionIndex)).toBe("projection_index");
  });

  it("carries tenant_id on every projection table (shared D1)", () => {
    expect(projectedRecords.tenantId).toBeDefined();
    expect(projectedRelations.tenantId).toBeDefined();
    expect(projectionIndex.tenantId).toBeDefined();
  });

  it("types projection_index values into text / num / date columns", () => {
    expect(projectionIndex.valueText).toBeDefined();
    expect(projectionIndex.valueNum).toBeDefined();
    expect(projectionIndex.valueDate).toBeDefined();
  });

  // CRITICAL fix（レビュー指摘）: source_version は publish/unpublish で変化しないため投影の
  // 順序ガードに使えない。DO 発行の単調な publish 世代番号を別カラムで持つ。
  it("gives projected_records a monotonic publish generation, separate from source_version", () => {
    expect(projectedRecords.sourceVersion).toBeDefined();
    expect(projectedRecords.publishSeq).toBeDefined();
  });

  // CRITICAL fix（レビュー指摘）: projected_records の行が既に消えているとき、INSERT 側には
  // publish_seq ガードが効かない。別テーブルの墓標で「この publish_seq 以下はもう有効な公開
  // ではない」を保持し、INSERT 側にもガードをかける。projected_records に "unpublished" フラグを
  // 足さない設計（公開読み取り API がフィルタし忘れると非公開データが漏れるため）。
  it("keeps unpublish tombstones in a table of their own, separate from projected_records", () => {
    expect(getTableName(projectionTombstones)).toBe("projection_tombstones");
    expect(projectionTombstones.tenantId).toBeDefined();
    expect(projectionTombstones.recordId).toBeDefined();
    expect(projectionTombstones.publishSeq).toBeDefined();
    expect(projectionTombstones.tombstonedAt).toBeDefined();
  });

  // Phase 5b: 公開 read API は DO を起こせないため、「どのフィールドがフィルタ/ソート可能で、
  // 値がどの型別カラムに入っているか・複数値か」を content_types から投影しておく必要がある
  // （§12.4「フィルタ/ソートは索引宣言済みフィールドに限る」を DO 非経由で検証するための表）。
  it("keeps a per-type field catalog for the public read API (Phase 5b)", () => {
    expect(getTableName(projectionFields)).toBe("projection_fields");
    expect(projectionFields.tenantId).toBeDefined();
    expect(projectionFields.type).toBeDefined();
    expect(projectionFields.fieldKey).toBeDefined();
    expect(projectionFields.kind).toBeDefined();
    expect(projectionFields.multi).toBeDefined();
    expect(projectionFields.projectedAt).toBeDefined();
  });
});
