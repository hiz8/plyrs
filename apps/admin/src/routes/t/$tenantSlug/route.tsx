import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Drawer } from "@plyrs/ui";
import { bg, text } from "@plyrs/ui/semantic.stylex";
import { Sidebar, type SidebarProps } from "../../../components/shell/sidebar";
import { TopBar } from "../../../components/shell/top-bar";
import { ApiError } from "../../../lib/api-client";
import { resetClientSession } from "../../../lib/client-session";
import { legacyPathname } from "../../../lib/legacy-redirect";
import { meQueryOptions, modulesQueryOptions, tenantsQueryOptions } from "../../../lib/queries";
import {
  TenantSyncProvider,
  useSyncHasSynced,
  useSyncStatus,
  useSyncTypes,
} from "../../../lib/sync-context";
import { syncIndicatorState } from "../../../lib/sync-indicator";

// a-navigation.md 3.4: 960px 未満でサイドバーをドロワーに畳み、上部バーを出す
const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  shell: {
    display: "grid",
    // サイドバーの幅 240px(a-navigation.md 3.5)
    gridTemplateColumns: { default: "240px 1fr", [NARROW]: "1fr" },
    minHeight: "100vh",
    backgroundColor: bg.canvas,
    color: text.default,
  },
  aside: {
    display: { default: "block", [NARROW]: "none" },
    position: "sticky",
    top: 0,
    height: "100vh",
  },
  column: { display: "flex", flexDirection: "column", minWidth: 0 },
  topBar: { display: { default: "none", [NARROW]: "flex" } },
  main: { flex: 1, minWidth: 0 },
});

export const Route = createFileRoute("/t/$tenantSlug")({
  // 認証ガード（2026-07-16 裁定 #3）: テナント一覧から slug を解決する。未認証は /login、
  // 非所属 slug は /tenants へ（存在有無は応答から区別できない — 一覧に無い、が全て）。
  beforeLoad: async ({ context, params, location }) => {
    // 案 A 6 章: 旧 URL はクエリ・ハッシュごと新しい URL へ転送する。router が beforeLoad の
    // redirect を replace で扱うため、旧 URL は履歴に残らない
    const legacy = legacyPathname(location.pathname);
    if (legacy !== null) {
      throw redirect({
        href: `${legacy}${location.searchStr}${location.hash === "" ? "" : `#${location.hash}`}`,
      });
    }
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

function ShellLayout() {
  const { tenant, slots, api, adminApi, tokens, queryClient, sync } = Route.useRouteContext();
  const navigate = useNavigate();
  // 裁定 4: 接続はテナントレイアウトの寿命に一致させる。テナント切替は
  // tenant.id が変わる = useMemo が作り直し、effect cleanup が旧接続を stop する。
  const tenantSync = useMemo(() => sync(tenant.id), [sync, tenant.id]);
  const syncStatus = useSyncStatus(tenantSync);
  const types = useSyncTypes(tenantSync);
  const hasSynced = useSyncHasSynced(tenantSync);
  const syncState = syncIndicatorState(syncStatus, hasSynced);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const tenantsQuery = useQuery(tenantsQueryOptions(api));
  // me の失敗でシェルは止めない(email が無いだけ)。modules は届くまで undefined
  const meQuery = useQuery(meQueryOptions(api));
  const modulesQuery = useQuery(modulesQueryOptions(adminApi, tenant.id));

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

  // 項目を選んで画面が変わったらドロワーを閉じる(a-navigation.md 3.4)
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // 広い幅(サイドバーが常設になる 960px 以上)へ広がったら、開いたままのドロワーを閉じる。
  // レイアウトの切替自体は CSS だけで行い、matchMedia はこの後始末にだけ使う(裁定 11)
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 960px)");
    if (query.matches) setDrawerOpen(false);
    const onChange = (event: { matches: boolean }) => {
      if (event.matches) setDrawerOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  async function logout() {
    tenantSync.stop();
    try {
      await api.logout();
    } catch {
      // サーバー側 revoke の失敗とローカル資格情報の破棄は独立の関心 — ローカルは必ず破棄する
    }
    resetClientSession({ queryClient, tokens });
    await navigate({ to: "/login" });
  }

  const sidebarProps: SidebarProps = {
    tenant,
    tenants: tenantsQuery.data ?? [tenant],
    email: meQuery.data?.email,
    types,
    hasSynced,
    modules: modulesQuery.data,
    slotItems: slots.get("nav:item"),
    syncState,
    pathname,
    onSwitchTenant: (slug) => void navigate({ to: "/t/$tenantSlug", params: { tenantSlug: slug } }),
    onOpenTenantList: () => void navigate({ to: "/tenants" }),
    onLogout: () => void logout(),
  };

  return (
    <div {...stylex.props(styles.shell)}>
      <div {...stylex.props(styles.aside)}>
        <Sidebar {...sidebarProps} />
      </div>
      <div {...stylex.props(styles.column)}>
        <div {...stylex.props(styles.topBar)}>
          <TopBar
            tenantName={tenant.name}
            syncState={syncState}
            isMenuOpen={drawerOpen}
            onToggleMenu={() => setDrawerOpen((open) => !open)}
          />
        </div>
        <main {...stylex.props(styles.main)}>
          <TenantSyncProvider sync={tenantSync}>
            <Outlet />
          </TenantSyncProvider>
        </main>
      </div>
      <Drawer isOpen={drawerOpen} onOpenChange={setDrawerOpen} label="メニュー" offsetTop={48}>
        <Sidebar {...sidebarProps} onNavigate={() => setDrawerOpen(false)} />
      </Drawer>
    </div>
  );
}
