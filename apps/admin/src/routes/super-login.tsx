import * as stylex from "@stylexjs/stylex";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, TextField } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { SuperApiError } from "../lib/super-api";

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
    width: "360px",
    padding: spacing.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: "8px",
    backgroundColor: colors.surface,
  },
  title: { fontSize: typography.sizeXl, margin: 0 },
  error: { color: colors.danger, fontSize: typography.sizeSm, margin: 0 },
  totpInfo: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: "6px",
    backgroundColor: colors.bg,
    fontSize: typography.sizeSm,
  },
  totpInfoNote: { color: colors.textMuted, margin: 0 },
  totpInfoValue: {
    margin: 0,
    wordBreak: "break-all",
    fontFamily: "monospace",
  },
});

interface StatusResponse {
  bootstrapped: boolean;
}

interface BootstrapResponse {
  adminId: string;
  totpSecret: string;
  otpauthUri: string;
}

export const Route = createFileRoute("/super-login")({
  loader: async ({ context }) => {
    return context.queryClient.fetchQuery({
      queryKey: ["super-auth-status"],
      queryFn: () => context.superApi.get<StatusResponse>("/super-auth/status"),
    });
  },
  component: SuperLoginPage,
});

function SuperLoginPage() {
  const { superApi } = Route.useRouteContext();
  const { bootstrapped } = Route.useLoaderData();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"bootstrap" | "login">(bootstrapped ? "login" : "bootstrap");
  const [totpInfo, setTotpInfo] = useState<{ totpSecret: string; otpauthUri: string } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitBootstrap() {
    setBusy(true);
    setError(null);
    try {
      const result = await superApi.post<BootstrapResponse>("/super-auth/bootstrap", {
        email,
        password,
      });
      setTotpInfo({ totpSecret: result.totpSecret, otpauthUri: result.otpauthUri });
      setMode("login");
    } catch {
      setError("初期セットアップに失敗しました。時間をおいて再試行してください");
    } finally {
      setBusy(false);
    }
  }

  async function submitLogin() {
    setBusy(true);
    setError(null);
    try {
      await superApi.post<{ adminId: string }>("/super-auth/login", {
        email,
        password,
        totpCode,
      });
      await navigate({ to: "/super" });
    } catch (cause) {
      setError(
        cause instanceof SuperApiError && cause.code === "invalid_credentials"
          ? "メールアドレス・パスワード・認証コードのいずれかが正しくありません"
          : "ログインに失敗しました。時間をおいて再試行してください",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main {...stylex.props(styles.page)}>
      <form
        {...stylex.props(styles.card)}
        // isRequired の native required 検証が submit イベントを止め TanStack Router の
        // ハンドラまで届かなくなるのを防ぐ(record-form.tsx と同じ既知の落とし穴)。
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void (mode === "bootstrap" ? submitBootstrap() : submitLogin());
        }}
      >
        <h1 {...stylex.props(styles.title)}>
          {mode === "bootstrap" ? "初期セットアップ" : "運営コンソールへログイン"}
        </h1>
        {totpInfo !== null && (
          <div {...stylex.props(styles.totpInfo)}>
            <p {...stylex.props(styles.totpInfoNote)}>
              認証アプリに登録してからコードを入力してください
            </p>
            {/* data-testid: E2E(apps/e2e)が totp secret を読み取るためのフック。表示ロジックは変更しない */}
            <p {...stylex.props(styles.totpInfoValue)} data-testid="totp-secret">
              {totpInfo.totpSecret}
            </p>
            <p {...stylex.props(styles.totpInfoValue)}>{totpInfo.otpauthUri}</p>
          </div>
        )}
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
        {mode === "login" && (
          <TextField
            label="認証コード"
            name="totpCode"
            inputMode="numeric"
            maxLength={6}
            value={totpCode}
            onChange={setTotpCode}
            isRequired
          />
        )}
        {error !== null ? (
          <p {...stylex.props(styles.error)} role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" isDisabled={busy}>
          {mode === "bootstrap" ? "登録" : "ログイン"}
        </Button>
      </form>
    </main>
  );
}
