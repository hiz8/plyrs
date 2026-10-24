import type { SyncRecord } from "@plyrs/sync-protocol";
import { buildMediaRows, type MediaRow } from "../lib/media-list";

// UUIDv7 の時刻部が違う ID(uploadedAtOf が日時を返す)
export const MEDIA_ID_A = "018f2b6a-7a0a-7000-8000-000000000e01";
export const MEDIA_ID_B = "018f2b6a-7a0b-7000-8000-000000000e02";
export const MEDIA_ID_C = "018f2b6a-7a0c-7000-8000-000000000e03";

export function mediaRow(id: string, input: Record<string, unknown>): MediaRow {
  const record = {
    id,
    type: "asset",
    input,
    fieldVersions: {},
    status: "draft",
    seq: 1,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    updatedBy: "u",
  } satisfies SyncRecord;
  const row = buildMediaRows([record])[0];
  if (row === undefined) throw new Error("row not built");
  return row;
}
