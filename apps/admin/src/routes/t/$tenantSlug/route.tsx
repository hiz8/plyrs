import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import type { ComponentType, ReactNode } from "react";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { ApiError } from "../../../lib/api-client";
import { tenantsQueryOptions } from "../../../lib/queries";

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
  tenantLink: { color: colors.textMuted, textDecoration: "none", fontSize: typography.sizeSm },
  content: { padding: spacing.lg },
});

export const Route = createFileRoute("/t/$tenantSlug")({
  // 認証ガード（2026-07-16 裁定 #3）: テナント一覧から slug を解決する。未認証は /login、
  // 非所属 slug は /tenants へ（存在有無は応答から区別できない — 一覧に無い、が全て）。
  beforeLoad: async ({ context, params }) => {
    let tenantList;
    try {
      tenantList = await context.queryClient.ensureQueryData(tenantsQueryOptions(context.api));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        throw redirect({ to: "/login" });
      }
      throw cause;
    }
    const tenant = tenantList.find((candidate) => candidate.slug === params.tenantSlug);
    if (tenant === undefined) {
      throw redirect({ to: "/tenants" });
    }
    return { tenant };
  },
  component: ShellLayout,
});

// スロット貢献の to は実行時文字列（モジュールが動的に登録する）のため typed routing の
// 静的 union に載らない。untyped へ落とすのはこの 1 箇所だけ（rpc-unwrap と同じ境界 cast 方針）。
const UntypedLink = Link as unknown as ComponentType<{
  to: string;
  params: Record<string, string>;
  className?: string;
  children: ReactNode;
}>;

function ShellLayout() {
  const { tenant, slots, api, tokens, queryClient } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const navigate = useNavigate();

  async function logout() {
    await api.logout();
    tokens.clear();
    queryClient.clear();
    await navigate({ to: "/login" });
  }

  return (
    <div {...stylex.props(styles.shell)}>
      <nav {...stylex.props(styles.sidebar)} aria-label="メインナビゲーション">
        <span {...stylex.props(styles.brand)}>plyrs</span>
        {slots.get("nav:item").map((item) => (
          <UntypedLink
            key={item.id}
            to={item.to}
            params={{ tenantSlug }}
            className={stylex.props(styles.navLink).className ?? ""}
          >
            {item.label}
          </UntypedLink>
        ))}
      </nav>
      <div {...stylex.props(styles.main)}>
        <header {...stylex.props(styles.header)}>
          <Link to="/tenants" {...stylex.props(styles.tenantLink)}>
            {tenant.name}（テナント切替）
          </Link>
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
