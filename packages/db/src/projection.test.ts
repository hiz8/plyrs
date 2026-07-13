import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  projectedRecords,
  projectedRelations,
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
});
