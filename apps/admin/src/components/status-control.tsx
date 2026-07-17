import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { WORKFLOW_STATUSES, type WorkflowStatus } from "@plyrs/metamodel";
import { Button, Select } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { publicationQueryOptions } from "../lib/queries";
import { useTenantSync } from "../lib/sync-context";
import { useCollectionRows } from "../lib/use-collection";
import { syncErrorMessage } from "./record-form";

const styles = stylex.create({
  root: { display: "flex", alignItems: "flex-end", gap: spacing.sm, flexWrap: "wrap" },
  warning: {
    display: "flex",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.danger,
    color: colors.danger,
    fontSize: typography.sizeSm,
  },
  error: { color: colors.danger, fontSize: typography.sizeSm },
});

const STATUS_LABELS: Record<WorkflowStatus, string> = {
  draft: "下書き",
  in_review: "レビュー中",
  ready: "公開準備完了",
  archived: "アーカイブ",
};

const tenantRoute = getRouteApi("/t/$tenantSlug");

function isWorkflowStatus(value: string): value is WorkflowStatus {
  return (WORKFLOW_STATUSES as readonly string[]).includes(value);
}

// ワークフロー status は同期経路の LWW（§7: status は裁定外）— collection.update で流す。
// archive 選択時に公開中なら警告して確認を挟む（design-spec §7: 強制 unpublish はしない）。
export function StatusControl({ typeKey, recordId }: { typeKey: string; recordId: string }) {
  const { tenant, adminApi } = tenantRoute.useRouteContext();
  const sync = useTenantSync();
  const collection = sync.registry.get(typeKey);
  const rows = useCollectionRows(collection);
  const record = rows.find((row) => row.id === recordId);
  const publication = useQuery(publicationQueryOptions(adminApi, tenant.id, recordId));
  const [pendingArchive, setPendingArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canWrite = tenant.role !== "viewer";
  // §7 の archive 警告は公開状態が既知であることが前提 — 解決まで操作を保留(通常ミリ秒)
  const publicationKnown = publication.data !== undefined;

  if (record === undefined || collection === undefined) {
    return null;
  }

  async function applyStatus(next: WorkflowStatus) {
    setError(null);
    try {
      if (collection === undefined) return;
      const tx = collection.update(recordId, (draft) => {
        draft.status = next;
      });
      await tx.isPersisted.promise;
    } catch (cause) {
      setError(syncErrorMessage(cause));
    }
  }

  function onSelect(value: string) {
    if (!isWorkflowStatus(value) || value === record?.status) {
      return;
    }
    if (value === "archived" && publication.data?.published === true) {
      setPendingArchive(true);
      return;
    }
    void applyStatus(value);
  }

  return (
    <div {...stylex.props(styles.root)}>
      <Select
        label="ステータス"
        items={WORKFLOW_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
        selectedValue={record.status}
        onChange={onSelect}
        isDisabled={!canWrite || !publicationKnown}
      />
      {pendingArchive && (
        <div {...stylex.props(styles.warning)} role="alert">
          <span>
            このレコードはまだ公開中です。アーカイブしても公開は維持されます（先に「公開を取り下げ」を推奨）。
          </span>
          <Button
            variant="secondary"
            onPress={() => {
              setPendingArchive(false);
              void applyStatus("archived");
            }}
          >
            公開したままアーカイブ
          </Button>
          <Button variant="secondary" onPress={() => setPendingArchive(false)}>
            キャンセル
          </Button>
        </div>
      )}
      {error !== null && <span {...stylex.props(styles.error)}>{error}</span>}
    </div>
  );
}
