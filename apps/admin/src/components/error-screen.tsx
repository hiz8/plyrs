import * as stylex from "@stylexjs/stylex";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { ApiError } from "../lib/api-client";

const styles = stylex.create({
  screen: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.xl,
    fontFamily: typography.fontFamily,
    color: colors.text,
  },
  title: { fontSize: typography.sizeXl, margin: 0 },
  detail: { color: colors.textMuted, margin: 0 },
});

// TanStack Router の errorComponent 契約: 捕捉した error を props で受ける。
// blocked 403 や 5xx が Router 既定の素の表示に落ちないための最終防衛線（6a Minor）。
export function ErrorScreen({ error }: { error: unknown }) {
  const detail =
    error instanceof ApiError
      ? `${error.status}: ${error.code}`
      : error instanceof Error
        ? error.message
        : String(error);
  return (
    <div {...stylex.props(styles.screen)} role="alert">
      <h1 {...stylex.props(styles.title)}>エラーが発生しました</h1>
      <p {...stylex.props(styles.detail)}>{detail}</p>
      <Button onPress={() => window.location.reload()}>再読み込み</Button>
    </div>
  );
}
