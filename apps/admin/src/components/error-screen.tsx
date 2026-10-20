import * as stylex from "@stylexjs/stylex";
import { Button } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { ApiError } from "../lib/api-client";
import { errorMessage } from "../lib/error-messages";
import { ERROR_SCREEN } from "../lib/labels";

const styles = stylex.create({
  screen: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.md,
    padding: space.xl,
    fontFamily: font.family,
    color: text.default,
  },
  title: { fontSize: font.pageTitle, margin: 0 },
  detail: { color: text.muted, margin: 0 },
});

// TanStack Router の errorComponent 契約: 捕捉した error を props で受ける。
// blocked 403 や 5xx が Router 既定の素の表示に落ちないための最終防衛線（6a Minor）。
export function ErrorScreen({ error }: { error: unknown }) {
  const detail =
    error instanceof ApiError
      ? `${error.status}: ${error.code}`
      : errorMessage(error, ERROR_SCREEN.fallback);
  return (
    <div {...stylex.props(styles.screen)} role="alert">
      <h1 {...stylex.props(styles.title)}>{ERROR_SCREEN.title}</h1>
      <p {...stylex.props(styles.detail)}>{detail}</p>
      <Button onPress={() => window.location.reload()}>{ERROR_SCREEN.reload}</Button>
    </div>
  );
}
