import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMemo, useState } from "react";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { ConnectionBanner } from "../../../../../components/connection-banner";
import { RecordForm, syncErrorMessage } from "../../../../../components/record-form";
import { createAssetServices } from "../../../../../lib/asset-services";
import {
  useSyncHasSynced,
  useSyncStatus,
  useSyncTypes,
  useTenantSync,
} from "../../../../../lib/sync-context";
import { useCollectionRows } from "../../../../../lib/use-collection";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  muted: { color: colors.textMuted },
  layout: { display: "grid", gridTemplateColumns: "1fr 280px", gap: spacing.lg },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
    flexWrap: "wrap",
  },
  panelColumn: { display: "flex", flexDirection: "column", gap: spacing.md },
  panel: {
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  panelTitle: { fontSize: typography.sizeSm, color: colors.textMuted, marginTop: 0 },
  banner: { color: colors.danger, fontSize: typography.sizeMd },
  dangerZone: { display: "flex", gap: spacing.sm, marginTop: spacing.lg },
});

export const Route = createFileRoute("/t/$tenantSlug/records/$typeKey/$recordId")({
  component: RecordEditorPage,
});

function RecordEditorPage() {
  const { slots, tenant, adminApi } = Route.useRouteContext();
  const { tenantSlug, typeKey, recordId } = Route.useParams();
  const sync = useTenantSync();
  const status = useSyncStatus(sync);
  const types = useSyncTypes(sync);
  const hasSynced = useSyncHasSynced(sync);
  const navigate = useNavigate();
  const assets = useMemo(() => createAssetServices(adminApi, tenant.id), [adminApi, tenant.id]);
  const collection = sync.registry.get(typeKey);
  const rows = useCollectionRows(collection);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // §12 必須①(2026-07-17 裁定): ゲートは初回同期の完了までに限る。以降の切断・再同期は
  // バナー表示のみでフォーム(未保存入力)を維持する。
  if (!hasSynced) {
    return <p {...stylex.props(styles.muted)}>同期中…（状態: {status}）</p>;
  }
  const contentType = types.find((type) => type.key === typeKey);
  if (contentType === undefined || collection === undefined) {
    return <p {...stylex.props(styles.muted)}>未知のコンテンツタイプです: {typeKey}</p>;
  }
  const record = rows.find((row) => row.id === recordId);
  if (record === undefined) {
    return (
      <p {...stylex.props(styles.muted)}>レコードが見つかりません（削除された可能性があります）</p>
    );
  }

  async function deleteRecord() {
    setDeleteError(null);
    try {
      if (collection === undefined) return;
      const tx = collection.delete(recordId);
      await tx.isPersisted.promise;
      await navigate({ to: "/t/$tenantSlug/records/$typeKey", params: { tenantSlug, typeKey } });
    } catch (cause) {
      setDeleteError(syncErrorMessage(cause));
    }
  }

  return (
    <>
      <ConnectionBanner status={status} />
      <h1 {...stylex.props(styles.title)}>{contentType.name} を編集</h1>
      <div {...stylex.props(styles.toolbar)}>
        {slots.get("record-editor:toolbar").map((contribution) => (
          <contribution.render key={contribution.id} typeKey={typeKey} recordId={recordId} />
        ))}
      </div>
      <div {...stylex.props(styles.layout)}>
        <div>
          <RecordForm
            contentType={contentType}
            types={types}
            registry={sync.registry}
            record={record}
            submitLabel="保存"
            assets={assets}
            onSubmit={async (input) => {
              const tx = collection.update(recordId, (draft) => {
                // WritableDeep<SyncRecord>["input"] は SyncRecord["input"] と構造同一だが
                // WritableDeep の再帰展開で TS が同一視できないため境界 cast(rpc-unwrap 様式)。
                draft.input = input as typeof draft.input;
              });
              await tx.isPersisted.promise;
            }}
          />
          <div {...stylex.props(styles.dangerZone)}>
            {confirmingDelete ? (
              <>
                <Button variant="secondary" onPress={() => void deleteRecord()}>
                  削除を確定
                </Button>
                <Button variant="secondary" onPress={() => setConfirmingDelete(false)}>
                  キャンセル
                </Button>
              </>
            ) : (
              <Button variant="secondary" onPress={() => setConfirmingDelete(true)}>
                削除
              </Button>
            )}
            {deleteError !== null && <span {...stylex.props(styles.banner)}>{deleteError}</span>}
          </div>
        </div>
        <aside {...stylex.props(styles.panelColumn)}>
          {slots.get("record-editor:panel").map((contribution) => (
            <section key={contribution.id} {...stylex.props(styles.panel)}>
              <h2 {...stylex.props(styles.panelTitle)}>{contribution.title}</h2>
              <contribution.render typeKey={typeKey} recordId={recordId} />
            </section>
          ))}
        </aside>
      </div>
    </>
  );
}
