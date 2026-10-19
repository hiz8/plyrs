import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Plus } from "lucide-react";
import { Button } from "@plyrs/ui";
import { accent, border, font, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import {
  PageBody,
  PageLoading,
  TenantPageHeader,
} from "../../../../../components/tenant-page-header";
import { currentCrumb, homeCrumb } from "../../../../../lib/breadcrumbs";
import { useCan } from "../../../../../lib/use-can";
import { WORKFLOW_STATUS_LABELS } from "../../../../../lib/labels";
import { labelForRecord } from "../../../../../lib/record-label";
import { useSyncHasSynced, useSyncTypes, useTenantSync } from "../../../../../lib/sync-context";
import { useCollectionRows } from "../../../../../lib/use-collection";

const styles = stylex.create({
  table: { borderCollapse: "collapse", width: "100%", fontSize: font.body },
  cell: {
    textAlign: "left",
    padding: space.sm,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  muted: { color: text.muted },
  link: { color: accent.default },
});

export const Route = createFileRoute("/t/$tenantSlug/content/$typeKey/")({
  component: RecordListPage,
});

function RecordListPage() {
  const { tenantSlug, typeKey } = Route.useParams();
  const sync = useTenantSync();
  const navigate = useNavigate();
  const canWrite = useCan("record:write");
  const types = useSyncTypes(sync);
  const hasSynced = useSyncHasSynced(sync);
  const contentType = types.find((type) => type.key === typeKey);
  const rows = useCollectionRows(sync.registry.get(typeKey));

  // §12 必須①(2026-07-17 裁定): ゲートは初回同期の完了までに限る。以降の切断・再同期は
  // バナー表示のみでフォーム(未保存入力)を維持する。
  if (!hasSynced) {
    return <PageLoading breadcrumbs={[homeCrumb(tenantSlug)]} />;
  }
  if (contentType === undefined) {
    return (
      <>
        <TenantPageHeader title={typeKey} breadcrumbs={[homeCrumb(tenantSlug)]} />
        <PageBody>
          <p {...stylex.props(styles.muted)}>未知のコンテンツタイプです: {typeKey}</p>
        </PageBody>
      </>
    );
  }

  const sorted = rows.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <>
      {/* h-common-surface.md 2 章 / a-navigation.md 5 章: 見出し・パンくず・主操作は PageHeader に集約。
          閲覧者(record:write なし)には主操作を出さない */}
      <TenantPageHeader
        title={contentType.name}
        breadcrumbs={[homeCrumb(tenantSlug), currentCrumb(contentType.name)]}
        primaryAction={
          canWrite ? (
            <Button
              icon={Plus}
              onPress={() =>
                void navigate({
                  to: "/t/$tenantSlug/content/$typeKey/new",
                  params: { tenantSlug, typeKey },
                })
              }
            >
              {contentType.name}を追加
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        {sorted.length === 0 ? (
          <p {...stylex.props(styles.muted)}>レコードはまだありません</p>
        ) : (
          <table {...stylex.props(styles.table)}>
            <thead>
              <tr>
                <th {...stylex.props(styles.cell)}>タイトル</th>
                <th {...stylex.props(styles.cell)}>ステータス</th>
                <th {...stylex.props(styles.cell)}>更新日時</th>
                <th {...stylex.props(styles.cell)}>version</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((record) => (
                <tr key={record.id}>
                  <td {...stylex.props(styles.cell)}>
                    <Link
                      to="/t/$tenantSlug/content/$typeKey/$recordId"
                      params={{ tenantSlug, typeKey, recordId: record.id }}
                      {...stylex.props(styles.link)}
                    >
                      {labelForRecord(types, record)}
                    </Link>
                  </td>
                  <td {...stylex.props(styles.cell)}>{WORKFLOW_STATUS_LABELS[record.status]}</td>
                  <td {...stylex.props(styles.cell)}>{record.updatedAt}</td>
                  <td {...stylex.props(styles.cell)}>{record.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PageBody>
    </>
  );
}
