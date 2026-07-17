import * as stylex from "@stylexjs/stylex";
import type { SyncStatus } from "@plyrs/sync-client";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";

const styles = stylex.create({
  banner: {
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textMuted,
    fontSize: typography.sizeMd,
  },
});

const STATUS_LABELS: Record<SyncStatus, string> = {
  idle: "待機",
  connecting: "接続中",
  syncing: "同期中",
  ready: "同期済み",
  closed: "切断",
};

// §12 必須①: 初回同期後の切断・再同期はフォームを維持し、このバナーだけで知らせる。
// 保存(push)はアウトボックスに積まれ、接続回復後に自動送信される(engine の設計)。
// 再接続ボタンはヘッダー(route.tsx)にあるためここには置かない。
export function ConnectionBanner({ status }: { status: SyncStatus }) {
  if (status === "ready") {
    return null;
  }
  return (
    <div role="status" {...stylex.props(styles.banner)}>
      サーバーと再同期中です（状態: {STATUS_LABELS[status]}
      ）。編集内容は維持され、保存は接続回復後に確定します。
    </div>
  );
}
