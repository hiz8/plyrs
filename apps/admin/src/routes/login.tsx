import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, TextField } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { TurnstileWidget } from "../components/turnstile-widget";
import { ApiError } from "../lib/api-client";

const styles = stylex.create({
  page: {
    display: "grid",
    placeItems: "center",
    minHeight: "100vh",
    fontFamily: typography.fontFamily,
    backgroundColor: colors.bg,
    color: colors.text,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    width: "320px",
    padding: spacing.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: "8px",
    backgroundColor: colors.surface,
  },
  title: { fontSize: typography.sizeXl, margin: 0 },
  error: { color: colors.danger, fontSize: typography.sizeSm, margin: 0 },
  alt: { fontSize: typography.sizeSm, color: colors.textMuted },
});

export const Route = createFileRoute("/login")({
  // §6: siteKey は公開情報。defaultSsr: false なのでこの loader はクライアント専用(super-login.tsx と同型)。
  loader: async ({ context }) => {
    return context.queryClient.fetchQuery({
      queryKey: ["turnstile-config"],
      queryFn: () => context.api.turnstileConfig(),
    });
  },
  component: LoginPage,
});

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === "invalid_credentials") {
    return "メールアドレスまたはパスワードが違います";
  }
  if (
    cause instanceof ApiError &&
    (cause.code === "turnstile_required" || cause.code === "turnstile_failed")
  ) {
    return "認証確認に失敗しました。もう一度お試しください";
  }
  return "ログインに失敗しました。時間をおいて再試行してください";
}

function LoginPage() {
  const { api } = Route.useRouteContext();
  const { siteKey } = Route.useLoaderData();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password, token ?? undefined);
      await navigate({ to: "/tenants" });
    } catch (cause) {
      setError(messageFor(cause));
      // Turnstile トークンは検証で消費され再利用不可(invalid_credentials 等の後続失敗でも同様)。
      // 失敗時は毎回クリアし、siteKey ありの場合は送信ボタンの disable ガードで再取得を強制する。
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main {...stylex.props(styles.page)}>
      <form
        {...stylex.props(styles.card)}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h1 {...stylex.props(styles.title)}>ログイン</h1>
        <TextField
          label="メールアドレス"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          isRequired
        />
        <TextField
          label="パスワード"
          name="password"
          type="password"
          value={password}
          onChange={setPassword}
          isRequired
        />
        {siteKey !== null ? <TurnstileWidget siteKey={siteKey} onToken={setToken} /> : null}
        {error !== null ? (
          <p {...stylex.props(styles.error)} role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" isDisabled={busy || (siteKey !== null && token === null)}>
          ログイン
        </Button>
        <span {...stylex.props(styles.alt)}>
          アカウントがない場合は <Link to="/signup">サインアップ</Link>
        </span>
      </form>
    </main>
  );
}
