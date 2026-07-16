import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button, TextField } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { ApiError } from "../lib/api-client";
import { tenantsQueryOptions } from "../lib/queries";

const styles = stylex.create({
  page: {
    maxWidth: "480px",
    margin: "0 auto",
    padding: spacing.xl,
    display: "flex",
    flexDirection: "column",
    gap: spacing.lg,
    fontFamily: typography.fontFamily,
    color: colors.text,
  },
  title: { fontSize: typography.sizeXl, margin: 0 },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
  },
  item: {
    display: "block",
    padding: spacing.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: "8px",
    backgroundColor: colors.surface,
    color: colors.text,
    textDecoration: "none",
  },
  role: { color: colors.textMuted, fontSize: typography.sizeSm, marginLeft: spacing.sm },
  form: { display: "flex", flexDirection: "column", gap: spacing.sm },
  subtitle: { fontSize: typography.sizeLg, marginBottom: 0 },
  error: { color: colors.danger, fontSize: typography.sizeSm, margin: 0 },
  muted: { color: colors.textMuted, fontSize: typography.sizeMd },
  footer: { display: "flex", justifyContent: "flex-end" },
});

export const Route = createFileRoute("/tenants")({
  loader: async ({ context }) => {
    try {
      // ensureQueryData はキャッシュに値がある限り isInvalidated を無視して即返すため、
      // 作成後の queryClient.invalidateQueries + router.invalidate() で再読込しても
      // 古い一覧のままになる。fetchQuery は isStaleByTime（invalidate 済みなら true）を
      // 見て必要なときだけ再フェッチするので、こちらを使う。
      return await context.queryClient.fetchQuery(tenantsQueryOptions(context.api));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        throw redirect({ to: "/login" });
      }
      throw cause;
    }
  },
  component: TenantsPage,
});

function TenantsPage() {
  const { api, queryClient, tokens } = Route.useRouteContext();
  const tenants = Route.useLoaderData();
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createTenant() {
    setBusy(true);
    setError(null);
    try {
      await api.createTenant(name, slug);
      setName("");
      setSlug("");
      await queryClient.invalidateQueries({ queryKey: ["tenants"] });
      await router.invalidate();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === "slug_taken"
          ? "この slug は既に使われています"
          : "テナントを作成できませんでした（slug は小文字英数字とハイフン）",
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api.logout();
    tokens.clear();
    queryClient.clear();
    await router.navigate({ to: "/login" });
  }

  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>テナントを選択</h1>
      {tenants.length === 0 ? (
        <p {...stylex.props(styles.muted)}>
          所属テナントがありません。下のフォームから作成できます。
        </p>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {tenants.map((tenant) => (
            <li key={tenant.id}>
              <Link
                to="/t/$tenantSlug/content-types"
                params={{ tenantSlug: tenant.slug }}
                {...stylex.props(styles.item)}
              >
                {tenant.name}
                <span {...stylex.props(styles.role)}>
                  {tenant.slug} / {tenant.role}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <section>
        <h2 {...stylex.props(styles.subtitle)}>新しいテナント</h2>
        <form
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault();
            void createTenant();
          }}
        >
          <TextField label="テナント名" value={name} onChange={setName} isRequired />
          <TextField label="slug" value={slug} onChange={setSlug} isRequired />
          {error !== null ? (
            <p {...stylex.props(styles.error)} role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" isDisabled={busy}>
            作成
          </Button>
        </form>
      </section>
      <div {...stylex.props(styles.footer)}>
        <Button variant="secondary" onPress={() => void logout()}>
          ログアウト
        </Button>
      </div>
    </main>
  );
}
