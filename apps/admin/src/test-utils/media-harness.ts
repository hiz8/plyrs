import type { SyncRecord } from "@plyrs/sync-protocol";
import { vi } from "vitest";
import { jsonResponse, authedRoutes, type Handler } from "./records-harness";

// メディア画面の router テスト共通の下地(asset-flow.test.tsx のレコードの様式)

export const ASSET_1 = "018f2b6a-7a0a-7000-8000-000000000e01";
export const ASSET_2 = "018f2b6a-7a0b-7000-8000-000000000e02";
export const ASSET_3 = "018f2b6a-7a0c-7000-8000-000000000e03";

export function assetRecord(
  id: string,
  filename: string,
  overrides: { input?: Record<string, unknown> } & Partial<Omit<SyncRecord, "input">> = {},
): SyncRecord {
  const { input, ...rest } = overrides;
  return {
    id,
    type: "asset",
    input: {
      filename,
      content_type: "image/png",
      size: 3,
      r2_key: `t1/${id}`,
      ...input,
    },
    fieldVersions: {},
    status: "draft",
    seq: 3,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
    ...rest,
  };
}

// 未使用一覧は既定で空。画像の取得(/assets/:id/url など)は個々のテストが足す
export function mediaRoutes(
  overrides: Record<string, Handler> = {},
  role = "owner",
): Record<string, Handler> {
  return authedRoutes(
    {
      "/v1/t/t1/assets/orphans": vi.fn(() => jsonResponse(200, { orphanIds: [] })),
      ...overrides,
    },
    role,
  );
}
