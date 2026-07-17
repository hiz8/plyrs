import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import type { SyncStatus } from "@plyrs/sync-client";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { ApiError } from "../../../lib/api-client";
import { tenantsQueryOptions } from "../../../lib/queries";
import { TenantSyncProvider, useSyncStatus } from "../../../lib/sync-context";

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
  headerSide: { display: "flex", alignItems: "center", gap: spacing.md },
  syncStatus: { color: colors.textMuted, fontSize: typography.sizeSm },
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

const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  idle: "待機",
  connecting: "接続中",
  syncing: "同期中",
  ready: "同期済み",
  closed: "切断",
};

function ShellLayout() {
  const { tenant, slots, api, tokens, queryClient, sync } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const navigate = useNavigate();
  // 裁定 4: 接続はテナントレイアウトの寿命に一致させる。テナント切替は
  // tenant.id が変わる = useMemo が作り直し、effect cleanup が旧接続を stop する。
  const tenantSync = useMemo(() => sync(tenant.id), [sync, tenant.id]);
  const syncStatus = useSyncStatus(tenantSync);

  useEffect(() => {
    tenantSync.start();
    // §8 契約 3: バックオフ枯渇後の再開はアプリの責務。online で start() を再度呼ぶ。
    const onOnline = () => tenantSync.start();
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      tenantSync.stop();
    };
  }, [tenantSync]);

  async function logout() {
    tenantSync.stop();
    try {
      await api.logout();
    } catch {
      // サーバー側 revoke の失敗とローカル資格情報の破棄は独立の関心 — ローカルは必ず破棄する
    }
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
          <div {...stylex.props(styles.headerSide)}>
            <span {...stylex.props(styles.syncStatus)}>同期: {SYNC_STATUS_LABELS[syncStatus]}</span>
            {syncStatus === "closed" && (
              <Button variant="secondary" onPress={() => tenantSync.start()}>
                再接続
              </Button>
            )}
            <Button variant="secondary" onPress={() => void logout()}>
              ログアウト
            </Button>
          </div>
        </header>
        <main {...stylex.props(styles.content)}>
          <TenantSyncProvider sync={tenantSync}>
            <Outlet />
          </TenantSyncProvider>
        </main>
      </div>
    </div>
  );
}
