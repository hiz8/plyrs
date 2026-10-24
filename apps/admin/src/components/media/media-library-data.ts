import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { AdminApi } from "../../lib/admin-api";
import type { ApiClient } from "../../lib/api-client";
import { resolveUsage } from "../../lib/media";
import { publicAssetUrl, resolvePublicOrigin } from "../../lib/public-api";
import {
  assetUsageQueryOptions,
  configQueryOptions,
  publicationsQueryOptions,
} from "../../lib/queries";
import type { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import { useRecordsOfTypes } from "../../lib/use-collection";
import type { DeleteMediaTarget } from "./delete-media-dialog";
import type { MediaDetailPanelProps } from "./media-detail-panel";

// F14: 使用箇所(詳細パネルと 1 件の削除確認で同じ問い合わせを共有する)。
// assetId が null のときは取得しない。取得の失敗は isLoadingError(背景再取得の失敗は含めない)
export function useAssetUsage(
  adminApi: AdminApi,
  tenantId: string,
  assetId: string | null,
  registry: CollectionRegistry,
  types: ContentTypeDefinition[],
): {
  panel: MediaDetailPanelProps["usage"];
  dialog: Extract<DeleteMediaTarget, { kind: "one" }>["usage"];
} {
  const usage = useQuery({
    ...assetUsageQueryOptions(adminApi, tenantId, assetId ?? ""),
    enabled: assetId !== null,
  });
  // F34: 同期の型が届いている参照元の型だけ購読してタイトルを引く
  const typeKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of usage.data ?? []) {
      if (entry.sourceType !== null && types.some((type) => type.key === entry.sourceType)) {
        keys.add(entry.sourceType);
      }
    }
    return [...keys];
  }, [usage.data, types]);
  const records = useRecordsOfTypes(registry, typeKeys);
  const entries = useMemo(() => {
    const byId = new Map(records.map((record) => [record.id, record]));
    return resolveUsage(usage.data ?? [], types, (id) => byId.get(id));
  }, [usage.data, records, types]);

  if (usage.isLoadingError) {
    return {
      panel: { status: "error", onRetry: () => void usage.refetch() },
      dialog: { status: "error" },
    };
  }
  if (usage.data === undefined) {
    return { panel: { status: "pending" }, dialog: { status: "pending" } };
  }
  return { panel: { status: "ready", entries }, dialog: { status: "ready", entries } };
}

// F8: 公開状態と公開 URL。パネルを開いている間だけ取得する
export function useAssetPublication(
  api: ApiClient,
  adminApi: AdminApi,
  tenantId: string,
  tenantSlug: string,
  assetId: string | null,
): MediaDetailPanelProps["publication"] {
  const config = useQuery({ ...configQueryOptions(api), enabled: assetId !== null });
  const publications = useQuery({
    ...publicationsQueryOptions(adminApi, tenantId, "asset"),
    enabled: assetId !== null,
  });
  if (publications.isLoadingError) {
    return { status: "error", onRetry: () => void publications.refetch() };
  }
  if (publications.data === undefined || assetId === null) return { status: "pending" };
  return {
    status: "ready",
    published: publications.data.some((entry) => entry.recordId === assetId),
    url: publicAssetUrl(
      resolvePublicOrigin(config.data?.publicApiOrigin ?? "", window.location.origin),
      tenantSlug,
      assetId,
    ),
  };
}
