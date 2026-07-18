import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { SuperApiError } from "../../lib/super-api";

const styles = stylex.create({
  shell: {
    display: "grid",
    gridTemplateColumns: "220px 1fr",
    minHeight: "100vh",
    fontFamily: typography.fontFamily,
    backgroundColor: colors.bg,
    color: colors.text,
  },
  sidebar: {
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: colors.border,
    padding: spacing.md,
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  brand: { fontSize: typography.sizeLg, fontWeight: 600, marginBottom: spacing.md },
  navLink: {
    color: colors.text,
    textDecoration: "none",
    padding: spacing.xs,
    borderRadius: "4px",
  },
  main: { display: "flex", flexDirection: "column" },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  headerEmail: { color: colors.textMuted, fontSize: typography.sizeSm },
  content: { padding: spacing.lg },
});

interface SuperMe {
  adminId: string;
  email: string | null;
}

const NAV_ITEMS = [
  { to: "/super", label: "テナント" },
  { to: "/super/users", label: "ユーザー" },
  { to: "/super/dlq", label: "DLQ" },
  { to: "/super/audit", label: "監査ログ" },
  { to: "/super/modules", label: "モジュール" },
] as const;

export const Route = createFileRoute("/super")({
  // super セッション cookie は毎回 D1 照会される(§11.6)。未認証(401)は /super-login へ。
  beforeLoad: async ({ context }) => {
    try {
      const me = await context.superApi.get<SuperMe>("/super-auth/me");
      return { me };
    } catch (cause) {
      if (cause instanceof SuperApiError && cause.status === 401) {
        throw redirect({ to: "/super-login" });
      }
      throw cause;
    }
  },
  component: SuperShellLayout,
});

function SuperShellLayout() {
  const { me, superApi, queryClient } = Route.useRouteContext();
  const navigate = useNavigate();

  async function logout() {
    try {
      await superApi.post("/super-auth/logout");
    } catch {
      // サーバー側 revoke の失敗とローカル状態の破棄は独立の関心 — ローカルは必ず遷移させる
    }
    queryClient.clear();
    await navigate({ to: "/super-login" });
  }

  return (
    <div {...stylex.props(styles.shell)}>
      <nav {...stylex.props(styles.sidebar)} aria-label="メインナビゲーション">
        <span {...stylex.props(styles.brand)}>plyrs 運営コンソール</span>
        {NAV_ITEMS.map((item) => (
          <Link key={item.to} to={item.to} {...stylex.props(styles.navLink)}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div {...stylex.props(styles.main)}>
        <header {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.headerEmail)}>{me.email ?? me.adminId}</span>
          <Button variant="secondary" onPress={() => void logout()}>
            ログアウト
          </Button>
        </header>
        <main {...stylex.props(styles.content)}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
