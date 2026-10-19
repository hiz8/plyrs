import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Avatar, Badge, Button, ICON_SIZE } from "@plyrs/ui";
import {
  bg,
  border,
  elevation,
  focus,
  font,
  radius,
  space,
  stroke,
  text,
} from "@plyrs/ui/semantic.stylex";
import { ApiError } from "../lib/api-client";
import { resetClientSession } from "../lib/client-session";
import { roleLabel, SITE_SELECT } from "../lib/labels";
import { meQueryOptions, tenantsQueryOptions } from "../lib/queries";

// サイト選択画面(a-navigation.md 8 章 / D2 S8)。所属が 1 件なら選ぶ余地が無いので転送する。
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    boxSizing: "border-box",
    backgroundColor: bg.surface,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: space.lg,
    fontFamily: font.family,
    color: text.default,
  },
  column: {
    width: "520px",
    maxWidth: "100%",
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
  },
  brand: {
    fontSize: font.body,
    fontWeight: font.weightBold,
    color: text.muted,
    letterSpacing: "0.06em",
  },
  title: { margin: 0, fontSize: font.pageTitle, fontWeight: font.weightBold },
  description: { margin: 0, fontSize: font.body, color: text.muted },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
  },
  card: {
    display: "flex",
    alignItems: "center",
    gap: space.inset,
    padding: space.md,
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: {
      default: border.default,
      ":hover": border.hover,
    },
    borderRadius: radius.container,
    boxShadow: {
      default: "none",
      ":hover": elevation.menu,
    },
    color: text.default,
    textDecoration: "none",
    outlineWidth: {
      default: 0,
      ":focus-visible": stroke.focus,
    },
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: font.label,
    fontWeight: font.weightBold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chevron: { color: text.muted, flexShrink: 0 },
});

export const Route = createFileRoute("/tenants")({
  loader: async ({ context }) => {
    let tenants;
    try {
      // ensureQueryData はキャッシュに値がある限り isInvalidated を無視して即返すため、
      // 作成後の queryClient.invalidateQueries + router.invalidate() で再読込しても
      // 古い一覧のままになる。fetchQuery は isStaleByTime（invalidate 済みなら true）を
      // 見て必要なときだけ再フェッチするので、こちらを使う。
      tenants = await context.queryClient.fetchQuery(tenantsQueryOptions(context.api));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        throw redirect({ to: "/login" });
      }
      throw cause;
    }
    // 所属が 1 件なら選択画面を飛ばす(a-navigation.md 8 章)
    const only = tenants.length === 1 ? tenants[0] : undefined;
    if (only !== undefined) {
      throw redirect({ to: "/t/$tenantSlug", params: { tenantSlug: only.slug } });
    }
    // メールは説明文の補足でしかないので、取得の失敗では画面を止めない
    let email: string | undefined;
    try {
      email = (await context.queryClient.ensureQueryData(meQueryOptions(context.api))).email;
    } catch {
      email = undefined;
    }
    return { tenants, email };
  },
  component: TenantsPage,
});

function TenantsPage() {
  const { api, queryClient, tokens } = Route.useRouteContext();
  const { tenants, email } = Route.useLoaderData();
  const router = useRouter();

  async function logout() {
    try {
      await api.logout();
    } catch {
      // サーバー側 revoke の失敗とローカル資格情報の破棄は独立の関心 — ローカルは必ず破棄する
    }
    resetClientSession({ queryClient, tokens });
    await router.navigate({ to: "/login" });
  }

  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.column)}>
        <span {...stylex.props(styles.brand)}>plyrs</span>
        <h1 {...stylex.props(styles.title)}>{SITE_SELECT.title}</h1>
        {tenants.length === 0 ? (
          <p {...stylex.props(styles.description)}>{SITE_SELECT.none}</p>
        ) : (
          <>
            <p {...stylex.props(styles.description)}>
              {email === undefined
                ? `${tenants.length} つのサイトに所属しています`
                : SITE_SELECT.description(email, tenants.length)}
            </p>
            <ul {...stylex.props(styles.list)}>
              {tenants.map((tenant) => (
                <li key={tenant.id}>
                  <Link
                    to="/t/$tenantSlug"
                    params={{ tenantSlug: tenant.slug }}
                    {...stylex.props(styles.card)}
                  >
                    <Avatar size="md" name={tenant.name} />
                    <span {...stylex.props(styles.name)}>{tenant.name}</span>
                    <Badge tone={tenant.role === "owner" ? "accent" : "neutral"}>
                      {roleLabel(tenant.role)}
                    </Badge>
                    <ChevronRight
                      size={ICON_SIZE.inline}
                      aria-hidden="true"
                      {...stylex.props(styles.chevron)}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <div>
          <Button variant="link" onPress={() => void logout()}>
            {SITE_SELECT.otherAccount}
          </Button>
        </div>
      </div>
    </main>
  );
}
