import * as stylex from "@stylexjs/stylex";
import type { SyncStatus } from "@plyrs/sync-client";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { SYNC_STATUS_LABELS } from "../lib/labels";

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

// §12 必須①: 初回同期後の切断・再同期はフォームを維持し、このバナーだけで知らせる。
// 保存(push)はアウトボックスに積まれ、接続回復後に自動送信される(engine の設計)。
// 再接続ボタンはヘッダー(route.tsx)にあるためここには置かない。
export function ConnectionBanner({ status }: { status: SyncStatus }) {
  if (status === "ready") {
    return null;
  }
  return (
    <div role="status" {...stylex.props(styles.banner)}>
      サーバーと再同期中です（状態: {SYNC_STATUS_LABELS[status]}
      ）。編集内容は維持され、保存は接続回復後に確定します。
    </div>
  );
}
