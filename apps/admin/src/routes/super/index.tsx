import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, TextField } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { SuperApiError } from "../../lib/super-api";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  muted: { color: colors.textMuted },
  banner: { color: colors.danger, fontSize: typography.sizeMd, margin: 0 },
  table: { borderCollapse: "collapse", width: "100%", fontSize: typography.sizeMd },
  caption: {
    captionSide: "top",
    textAlign: "left",
    color: colors.textMuted,
    fontSize: typography.sizeSm,
    paddingBottom: spacing.xs,
  },
  cell: {
    textAlign: "left",
    padding: spacing.sm,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    verticalAlign: "middle",
  },
  link: { color: colors.accent },
  actions: { display: "flex", gap: spacing.sm },
  section: { marginTop: spacing.xl },
  subtitle: { fontSize: typography.sizeLg, marginBottom: spacing.sm },
  form: { display: "flex", flexDirection: "column", gap: spacing.sm, maxWidth: "480px" },
  dialog: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.danger,
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    maxWidth: "480px",
  },
  dialogTitle: { fontSize: typography.sizeMd, fontWeight: 600, margin: 0 },
});

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  memberCount: number;
}

const TENANTS_QUERY_KEY = ["super", "tenants"] as const;

export const Route = createFileRoute("/super/")({
  component: SuperTenantsPage,
});

function errorMessageForCreate(cause: unknown): string {
  if (cause instanceof SuperApiError) {
    if (cause.code === "slug_taken") {
      return "この slug は既に使われています";
    }
    if (cause.code === "unknown_owner") {
      return "指定したメールアドレスのユーザーが見つかりません";
    }
  }
  return "テナントを作成できませんでした";
}

function SuperTenantsPage() {
  const { superApi } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const tenants = useQuery({
    queryKey: TENANTS_QUERY_KEY,
    queryFn: () => superApi.get<{ tenants: TenantRow[] }>("/super/v1/tenants"),
  });

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: (input: { name: string; slug: string; ownerEmail?: string }) =>
      superApi.post<{ tenantId: string }>("/super/v1/tenants", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY }),
  });

  async function createTenant() {
    setCreateError(null);
    try {
      await createMutation.mutateAsync({
        name,
        slug,
        ...(ownerEmail === "" ? {} : { ownerEmail }),
      });
      setName("");
      setSlug("");
      setOwnerEmail("");
    } catch (cause) {
      setCreateError(errorMessageForCreate(cause));
    }
  }

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameMutation = useMutation({
    mutationFn: ({ id, name: newName }: { id: string; name: string }) =>
      superApi.patch<{ ok: boolean }>(`/super/v1/tenants/${id}`, { name: newName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY }),
  });

  function startRename(tenant: TenantRow) {
    setRenamingId(tenant.id);
    setRenameDraft(tenant.name);
    setRenameError(null);
  }

  async function saveRename(id: string) {
    setRenameError(null);
    try {
      await renameMutation.mutateAsync({ id, name: renameDraft });
      setRenamingId(null);
    } catch {
      setRenameError("名称を変更できませんでした");
    }
  }

  const [deleteTarget, setDeleteTarget] = useState<TenantRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => superApi.delete<{ ok: boolean }>(`/super/v1/tenants/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY }),
  });

  function startDelete(tenant: TenantRow) {
    setDeleteTarget(tenant);
    setDeleteConfirmText("");
    setDeleteError(null);
  }

  // 破壊的操作のガード: slug の再入力が一致したときにだけ DELETE を発火する。
  async function confirmDelete() {
    if (deleteTarget === null || deleteConfirmText !== deleteTarget.slug) {
      return;
    }
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteConfirmText("");
    } catch {
      setDeleteError("削除できませんでした");
    }
  }

  const rows = tenants.data?.tenants ?? [];

  return (
    <>
      <h1 {...stylex.props(styles.title)}>テナント</h1>
      {tenants.isError ? (
        <p role="alert" {...stylex.props(styles.banner)}>
          テナント一覧を取得できませんでした
        </p>
      ) : null}
      {tenants.isPending ? (
        <p {...stylex.props(styles.muted)}>読み込み中…</p>
      ) : rows.length === 0 ? (
        <p {...stylex.props(styles.muted)}>テナントはまだありません</p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <caption {...stylex.props(styles.caption)}>登録済みテナントの一覧</caption>
          <thead>
            <tr>
              <th {...stylex.props(styles.cell)}>名前</th>
              <th {...stylex.props(styles.cell)}>slug</th>
              <th {...stylex.props(styles.cell)}>メンバー数</th>
              <th {...stylex.props(styles.cell)}>作成日</th>
              <th {...stylex.props(styles.cell)}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tenant) => (
              <tr key={tenant.id}>
                <td {...stylex.props(styles.cell)}>
                  {renamingId === tenant.id ? (
                    <TextField label="名前" value={renameDraft} onChange={setRenameDraft} />
                  ) : (
                    <Link
                      to="/super/tenants/$tenantId"
                      params={{ tenantId: tenant.id }}
                      {...stylex.props(styles.link)}
                    >
                      {tenant.name}
                    </Link>
                  )}
                </td>
                <td {...stylex.props(styles.cell)}>{tenant.slug}</td>
                <td {...stylex.props(styles.cell)}>{tenant.memberCount}</td>
                <td {...stylex.props(styles.cell)}>{tenant.createdAt}</td>
                <td {...stylex.props(styles.cell)}>
                  <span {...stylex.props(styles.actions)}>
                    {renamingId === tenant.id ? (
                      <>
                        <Button
                          isDisabled={renameMutation.isPending}
                          onPress={() => void saveRename(tenant.id)}
                        >
                          保存
                        </Button>
                        <Button variant="secondary" onPress={() => setRenamingId(null)}>
                          キャンセル
                        </Button>
                      </>
                    ) : (
                      <Button variant="secondary" onPress={() => startRename(tenant)}>
                        名称変更
                      </Button>
                    )}
                    <Button variant="secondary" onPress={() => startDelete(tenant)}>
                      削除
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {renameError !== null ? (
        <p role="alert" {...stylex.props(styles.banner)}>
          {renameError}
        </p>
      ) : null}

      {deleteTarget !== null && (
        <div role="alertdialog" aria-label="テナントの削除" {...stylex.props(styles.dialog)}>
          <h2 {...stylex.props(styles.dialogTitle)}>「{deleteTarget.name}」を削除しますか?</h2>
          <p {...stylex.props(styles.muted)}>
            この操作は取り消せません。確認のため slug「{deleteTarget.slug}
            」を入力してください。
          </p>
          <TextField
            label="確認用 slug"
            value={deleteConfirmText}
            onChange={setDeleteConfirmText}
          />
          {deleteError !== null ? (
            <p role="alert" {...stylex.props(styles.banner)}>
              {deleteError}
            </p>
          ) : null}
          <span {...stylex.props(styles.actions)}>
            <Button
              variant="secondary"
              isDisabled={deleteConfirmText !== deleteTarget.slug || deleteMutation.isPending}
              onPress={() => void confirmDelete()}
            >
              削除を確定
            </Button>
            <Button variant="secondary" onPress={() => setDeleteTarget(null)}>
              キャンセル
            </Button>
          </span>
        </div>
      )}

      <section {...stylex.props(styles.section)}>
        <h2 {...stylex.props(styles.subtitle)}>新しいテナント</h2>
        <form
          {...stylex.props(styles.form)}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void createTenant();
          }}
        >
          <TextField label="テナント名" value={name} onChange={setName} isRequired />
          <TextField label="slug" value={slug} onChange={setSlug} isRequired />
          <TextField
            label="オーナーのメールアドレス(任意)"
            type="email"
            value={ownerEmail}
            onChange={setOwnerEmail}
          />
          {createError !== null ? (
            <p role="alert" {...stylex.props(styles.banner)}>
              {createError}
            </p>
          ) : null}
          <Button type="submit" isDisabled={createMutation.isPending}>
            作成
          </Button>
        </form>
      </section>
    </>
  );
}
