import * as stylex from "@stylexjs/stylex";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";

// super 配下ページ間で重複していた stylex 定義の共通化(見た目は変更しない)。
// ファイル名の "-" 接頭辞は TanStack Router のルートファイルスキャン対象から除外するため
// (routeFileIgnorePrefix 既定値 "-")— ルート追加にはならない。
export const superStyles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  muted: { color: colors.textMuted },
  banner: { color: colors.danger, fontSize: typography.sizeMd, margin: 0 },
  table: { borderCollapse: "collapse", width: "100%", fontSize: typography.sizeMd },
  caption: {
    captionSide: "top",
    textAlign: "left",
    color: colors.textMuted,
    fontSize: typography.sizeSm,
    paddingBottom: spacing.xs,
  },
  cell: {
    textAlign: "left",
    padding: spacing.sm,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    verticalAlign: "middle",
  },
  actions: { display: "flex", gap: spacing.sm },
  dialog: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.danger,
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    maxWidth: "480px",
  },
  dialogTitle: { fontSize: typography.sizeMd, fontWeight: 600, margin: 0 },
  section: { marginTop: spacing.xl },
  subtitle: { fontSize: typography.sizeLg, marginBottom: spacing.sm },
});
