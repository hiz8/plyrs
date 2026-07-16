import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, TextField } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
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

export const Route = createFileRoute("/signup")({ component: SignupPage });

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === "email_taken") {
    return "このメールアドレスは既に登録されています";
  }
  if (cause instanceof ApiError && cause.status === 400) {
    return "入力内容を確認してください（パスワードは 12 文字以上）";
  }
  return "サインアップに失敗しました。時間をおいて再試行してください";
}

function SignupPage() {
  const { api } = Route.useRouteContext();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.signup(email, password);
      await navigate({ to: "/tenants" });
    } catch (cause) {
      setError(messageFor(cause));
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
        <h1 {...stylex.props(styles.title)}>サインアップ</h1>
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
          minLength={12}
        />
        {error !== null ? (
          <p {...stylex.props(styles.error)} role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" isDisabled={busy}>
          サインアップ
        </Button>
        <span {...stylex.props(styles.alt)}>
          アカウントがある場合は <Link to="/login">ログイン</Link>
        </span>
      </form>
    </main>
  );
}
