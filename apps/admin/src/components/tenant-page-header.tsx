import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { PageHeader, Skeleton, type PageHeaderProps } from "@plyrs/ui";
import { space } from "@plyrs/ui/semantic.stylex";
import { syncIndicatorState } from "../lib/sync-indicator";
import { useSyncHasSynced, useSyncStatus, useTenantSync } from "../lib/sync-context";
import { ConnectionBanner } from "./connection-banner";

// 幅 960px 未満では余白を詰める(StyleX 0.19.1 に defineConsts が無いのでファイルごとの定数)
const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  body: {
    paddingInline: { default: space.pageGutter, [NARROW]: space.md },
    paddingBlock: space.lg,
  },
  loading: { display: "flex", flexDirection: "column", gap: space.sm },
});

// シェルで接続バナーを出す唯一の場所。切断中だけ PageHeader のバナー枠へ差し込む
export function TenantPageHeader(props: Omit<PageHeaderProps, "banner">) {
  const sync = useTenantSync();
  const status = useSyncStatus(sync);
  const hasSynced = useSyncHasSynced(sync);
  const disconnected = syncIndicatorState(status, hasSynced) === "disconnected";
  return (
    <PageHeader
      {...props}
      banner={disconnected ? <ConnectionBanner onReconnect={() => sync.start()} /> : undefined}
    />
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.body)}>{children}</div>;
}

// 初回同期の前の表示(見出しと本文をスケルトンにする)
export function PageLoading({ breadcrumbs }: Pick<PageHeaderProps, "breadcrumbs">) {
  return (
    <>
      <TenantPageHeader title={<Skeleton width={160} height={24} />} breadcrumbs={breadcrumbs} />
      <PageBody>
        <div role="status" aria-label="読み込み中" {...stylex.props(styles.loading)}>
          <Skeleton height={14} width="100%" />
          <Skeleton height={14} width="80%" />
          <Skeleton height={14} width="60%" />
        </div>
      </PageBody>
    </>
  );
}
