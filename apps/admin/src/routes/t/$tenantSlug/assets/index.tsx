import { createFileRoute, Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import { AssetThumb } from "../../../../components/asset-thumb";
import { ConnectionBanner } from "../../../../components/connection-banner";
import { labelForRecord } from "../../../../components/record-form";
import { createAssetServices } from "../../../../lib/asset-services";
import { assetUsageQueryOptions, orphanAssetsQueryOptions } from "../../../../lib/queries";
import {
  useSyncHasSynced,
  useSyncStatus,
  useSyncTypes,
  useTenantSync,
} from "../../../../lib/sync-context";
import { useCollectionRows } from "../../../../lib/use-collection";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    gap: spacing.md,
    flexWrap: "wrap",
  },
  muted: { color: colors.textMuted },
  table: { borderCollapse: "collapse", width: "100%", fontSize: typography.sizeMd },
  cell: {
    textAlign: "left",
    padding: spacing.sm,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    verticalAlign: "middle",
  },
  link: { color: colors.accent },
  banner: { color: colors.danger, fontSize: typography.sizeMd },
  dialog: {
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    maxWidth: "480px",
  },
  dialogTitle: { fontSize: typography.sizeMd, fontWeight: 600, margin: 0 },
  usageList: { margin: 0, paddingInlineStart: spacing.lg },
  actions: { display: "flex", gap: spacing.sm },
});

export const Route = createFileRoute("/t/$tenantSlug/assets/")({
  component: AssetListPage,
});

function formatSize(size: unknown): string {
  if (typeof size !== "number") {
    return "-";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  return size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function AssetListPage() {
  const { tenant, adminApi } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const sync = useTenantSync();
  const status = useSyncStatus(sync);
  const types = useSyncTypes(sync);
  const hasSynced = useSyncHasSynced(sync);
  const rows = useCollectionRows(sync.registry.get(ASSET_TYPE_KEY));
  const assets = useMemo(() => createAssetServices(adminApi, tenant.id), [adminApi, tenant.id]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 未参照フィルタ(裁定 6): ON のときだけ DO RPC(relations 逆引き)を引く
  const orphans = useQuery({
    ...orphanAssetsQueryOptions(adminApi, tenant.id),
    enabled: orphansOnly,
  });
  const usage = useQuery({
    ...assetUsageQueryOptions(adminApi, tenant.id, deleteTarget ?? ""),
    enabled: deleteTarget !== null,
  });

  if (!hasSynced) {
    return <p {...stylex.props(styles.muted)}>同期中…（状態: {status}）</p>;
  }

  const orphanSet = new Set(orphans.data ?? []);
  const visible = orphansOnly ? rows.filter((row) => orphanSet.has(row.id)) : rows;
  const sorted = visible.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (file === undefined) {
      return;
    }
    setUploadError(null);
    try {
      await assets.upload(file);
      // 一覧への出現は WS broadcast → コレクション反映で自動(アップロード API が DO 経由で
      // change を配るため、ここで再取得は要らない)。orphan フィルタ表示中は数え直す。
      if (orphansOnly) {
        await orphans.refetch();
      }
    } catch {
      setUploadError("アップロードに失敗しました。ファイルサイズと接続を確認してください。");
    } finally {
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function confirmDelete() {
    if (deleteTarget === null) {
      return;
    }
    setDeleteError(null);
    try {
      await adminApi.deleteRecord(tenant.id, deleteTarget);
      // 一覧からの消滅はトゥームストーンの WS broadcast で反映される
      setDeleteTarget(null);
    } catch {
      setDeleteError("削除に失敗しました。");
    }
  }

  return (
    <>
      <ConnectionBanner status={status} />
      <h1 {...stylex.props(styles.title)}>アセット</h1>
      <div {...stylex.props(styles.toolbar)}>
        <Checkbox isSelected={orphansOnly} onChange={setOrphansOnly}>
          未参照のみ表示
        </Checkbox>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            aria-label="アセットをアップロード"
            onChange={(event) => void upload(event.currentTarget.files)}
          />
        </div>
      </div>
      {uploadError !== null && (
        <p role="alert" {...stylex.props(styles.banner)}>
          {uploadError}
        </p>
      )}
      {deleteTarget !== null && (
        <div role="alertdialog" aria-label="アセットの削除" {...stylex.props(styles.dialog)}>
          <h2 {...stylex.props(styles.dialogTitle)}>このアセットを削除しますか？</h2>
          {usage.isPending ? (
            <p {...stylex.props(styles.muted)}>使用箇所を確認中…</p>
          ) : usage.isError ? (
            <p {...stylex.props(styles.banner)}>使用箇所を取得できませんでした。</p>
          ) : (usage.data?.length ?? 0) === 0 ? (
            <p {...stylex.props(styles.muted)}>参照はありません（未参照のアセットです）。</p>
          ) : (
            <>
              <p {...stylex.props(styles.muted)}>
                次の場所から参照されています。削除すると参照は不在(リンク切れ)になります:
              </p>
              <ul {...stylex.props(styles.usageList)}>
                {(usage.data ?? []).map((entry, index) => (
                  <li key={`${entry.sourceId}-${entry.sourceField}-${index}`}>
                    {entry.sourceType ?? "(不明な型)"} / {entry.sourceField}
                    {entry.origin === "body" ? "（本文中）" : ""} — {entry.sourceId.slice(0, 8)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {deleteError !== null && <p {...stylex.props(styles.banner)}>{deleteError}</p>}
          <div {...stylex.props(styles.actions)}>
            <Button variant="secondary" onPress={() => void confirmDelete()}>
              削除を確定
            </Button>
            <Button variant="secondary" onPress={() => setDeleteTarget(null)}>
              キャンセル
            </Button>
          </div>
        </div>
      )}
      {orphansOnly && orphans.isPending ? (
        <p {...stylex.props(styles.muted)}>未参照アセットを確認中…</p>
      ) : orphansOnly && orphans.isError ? (
        <p role="alert" {...stylex.props(styles.banner)}>
          未参照アセットの取得に失敗しました。
        </p>
      ) : sorted.length === 0 ? (
        <p {...stylex.props(styles.muted)}>
          {orphansOnly ? "未参照のアセットはありません" : "アセットはまだありません"}
        </p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.cell)}>プレビュー</th>
              <th {...stylex.props(styles.cell)}>ファイル名</th>
              <th {...stylex.props(styles.cell)}>種類</th>
              <th {...stylex.props(styles.cell)}>サイズ</th>
              <th {...stylex.props(styles.cell)}>alt</th>
              <th {...stylex.props(styles.cell)}>操作</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((record) => (
              <tr key={record.id}>
                <td {...stylex.props(styles.cell)}>
                  <AssetThumb record={record} resolveUrl={assets.resolveUrl} />
                </td>
                <td {...stylex.props(styles.cell)}>{labelForRecord(types, record)}</td>
                <td {...stylex.props(styles.cell)}>
                  {typeof record.input["content_type"] === "string"
                    ? record.input["content_type"]
                    : "-"}
                </td>
                <td {...stylex.props(styles.cell)}>{formatSize(record.input["size"])}</td>
                <td {...stylex.props(styles.cell)}>
                  {typeof record.input["alt"] === "string" ? record.input["alt"] : ""}
                </td>
                <td {...stylex.props(styles.cell)}>
                  <span {...stylex.props(styles.actions)}>
                    <Link
                      to="/t/$tenantSlug/records/$typeKey/$recordId"
                      params={{ tenantSlug, typeKey: ASSET_TYPE_KEY, recordId: record.id }}
                      {...stylex.props(styles.link)}
                    >
                      編集
                    </Link>
                    <Button variant="secondary" onPress={() => setDeleteTarget(record.id)}>
                      削除
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
