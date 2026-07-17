import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { v7 as uuidv7 } from "uuid";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { colors, typography } from "@plyrs/ui/tokens.stylex";
import { ConnectionBanner } from "../../../../../components/connection-banner";
import { RecordForm } from "../../../../../components/record-form";
import {
  useSyncHasSynced,
  useSyncStatus,
  useSyncTypes,
  useTenantSync,
} from "../../../../../lib/sync-context";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  muted: { color: colors.textMuted },
});

export const Route = createFileRoute("/t/$tenantSlug/records/$typeKey/new")({
  component: NewRecordPage,
});

function NewRecordPage() {
  const { tenantSlug, typeKey } = Route.useParams();
  const sync = useTenantSync();
  const status = useSyncStatus(sync);
  const types = useSyncTypes(sync);
  const hasSynced = useSyncHasSynced(sync);
  const navigate = useNavigate();
  const contentType = types.find((type) => type.key === typeKey);
  const collection = sync.registry.get(typeKey);

  // §12 必須①(2026-07-17 裁定): ゲートは初回同期の完了までに限る。以降の切断・再同期は
  // バナー表示のみでフォーム(未保存入力)を維持する。
  if (!hasSynced) {
    return <p {...stylex.props(styles.muted)}>同期中…（状態: {status}）</p>;
  }
  if (contentType === undefined || collection === undefined) {
    return <p {...stylex.props(styles.muted)}>未知のコンテンツタイプです: {typeKey}</p>;
  }

  return (
    <>
      <ConnectionBanner status={status} />
      <h1 {...stylex.props(styles.title)}>{contentType.name} を作成</h1>
      <RecordForm
        contentType={contentType}
        types={types}
        registry={sync.registry}
        record={null}
        submitLabel="作成"
        onSubmit={async (input) => {
          // design-spec §5: ID はクライアント生成（UUIDv7）。updatedAt/updatedBy/seq/version は
          // サーバー権威 — ack の確定レコードで上書きされる仮値を入れる。
          const record: SyncRecord = {
            id: uuidv7(),
            type: typeKey,
            input,
            fieldVersions: {},
            status: "draft",
            seq: 0,
            version: 0,
            deletedAt: null,
            updatedAt: new Date().toISOString(),
            updatedBy: "",
          };
          const tx = collection.insert(record);
          await tx.isPersisted.promise;
          await navigate({
            to: "/t/$tenantSlug/records/$typeKey",
            params: { tenantSlug, typeKey },
          });
        }}
      />
    </>
  );
}
