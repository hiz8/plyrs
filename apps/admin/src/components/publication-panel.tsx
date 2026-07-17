import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { colors, typography } from "@plyrs/ui/tokens.stylex";
import { publicationQueryOptions } from "../lib/queries";
import { useTenantSync } from "../lib/sync-context";
import { useCollectionRows } from "../lib/use-collection";

const styles = stylex.create({
  body: { fontSize: typography.sizeMd, color: colors.text, margin: 0 },
  muted: { color: colors.textMuted },
  stale: { color: colors.danger },
});

const tenantRoute = getRouteApi("/t/$tenantSlug");

// 公開状態の 3 値（design-spec §7 の version 比較そのまま）:
// snapshot なし → 未公開 / version == sourceVersion → クリーン / version > sourceVersion → 要再公開
export function PublicationPanel({ typeKey, recordId }: { typeKey: string; recordId: string }) {
  const { tenant, adminApi } = tenantRoute.useRouteContext();
  const sync = useTenantSync();
  const rows = useCollectionRows(sync.registry.get(typeKey));
  const record = rows.find((row) => row.id === recordId);
  const publication = useQuery(publicationQueryOptions(adminApi, tenant.id, recordId));

  if (publication.data === undefined) {
    return <p {...stylex.props(styles.body, styles.muted)}>読み込み中…</p>;
  }
  if (!publication.data.published) {
    return <p {...stylex.props(styles.body, styles.muted)}>未公開</p>;
  }
  const stale = record !== undefined && record.version > publication.data.sourceVersion;
  return (
    <div>
      <p {...stylex.props(styles.body)}>公開中（{publication.data.publishedAt}）</p>
      {stale && (
        <p {...stylex.props(styles.body, styles.stale)}>
          公開後に編集されています — 未公開の変更があります（再公開で反映）
        </p>
      )}
    </div>
  );
}
