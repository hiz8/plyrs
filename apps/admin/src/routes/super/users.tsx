import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, TextField } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  muted: { color: colors.textMuted },
  banner: { color: colors.danger, fontSize: typography.sizeMd, margin: 0 },
  form: {
    display: "flex",
    alignItems: "flex-end",
    gap: spacing.sm,
    marginBottom: spacing.lg,
    maxWidth: "480px",
  },
  formField: { flex: 1 },
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
  actions: { display: "flex", gap: spacing.sm },
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

interface UserRow {
  id: string;
  email: string;
  createdAt: string;
  membershipCount: number;
}

interface PendingAction {
  kind: "ban" | "unban";
  user: UserRow;
}

export const Route = createFileRoute("/super/users")({
  component: SuperUsersPage,
});

function SuperUsersPage() {
  const { superApi } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");

  const usersQueryKey = ["super", "users", query];
  const usersQuery = useQuery({
    queryKey: usersQueryKey,
    queryFn: () =>
      superApi.get<{ users: UserRow[] }>(`/super/v1/users?q=${encodeURIComponent(query)}`),
  });

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const banMutation = useMutation({
    mutationFn: (userId: string) =>
      superApi.post<{ ok: boolean; disconnected: number }>(`/super/v1/users/${userId}/ban`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersQueryKey }),
  });
  const unbanMutation = useMutation({
    mutationFn: (userId: string) =>
      superApi.post<{ ok: boolean }>(`/super/v1/users/${userId}/unban`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersQueryKey }),
  });

  function startAction(kind: PendingAction["kind"], user: UserRow) {
    setPendingAction({ kind, user });
    setActionError(null);
  }

  async function confirmAction() {
    if (pendingAction === null) {
      return;
    }
    setActionError(null);
    try {
      if (pendingAction.kind === "ban") {
        await banMutation.mutateAsync(pendingAction.user.id);
      } else {
        await unbanMutation.mutateAsync(pendingAction.user.id);
      }
      setPendingAction(null);
    } catch {
      setActionError(
        pendingAction.kind === "ban" ? "BAN に失敗しました" : "BAN 解除に失敗しました",
      );
    }
  }

  const rows = usersQuery.data?.users ?? [];

  return (
    <>
      <h1 {...stylex.props(styles.title)}>ユーザー</h1>
      <form
        {...stylex.props(styles.form)}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(searchInput);
        }}
      >
        <span {...stylex.props(styles.formField)}>
          <TextField label="メールアドレスで検索" value={searchInput} onChange={setSearchInput} />
        </span>
        <Button type="submit">検索</Button>
      </form>
      {usersQuery.isError ? (
        <p role="alert" {...stylex.props(styles.banner)}>
          ユーザー一覧を取得できませんでした
        </p>
      ) : null}
      {usersQuery.isPending ? (
        <p {...stylex.props(styles.muted)}>読み込み中…</p>
      ) : rows.length === 0 ? (
        <p {...stylex.props(styles.muted)}>該当するユーザーがいません</p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <caption {...stylex.props(styles.caption)}>ユーザーの一覧</caption>
          <thead>
            <tr>
              <th {...stylex.props(styles.cell)}>メール</th>
              <th {...stylex.props(styles.cell)}>所属数</th>
              <th {...stylex.props(styles.cell)}>登録日</th>
              <th {...stylex.props(styles.cell)}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td {...stylex.props(styles.cell)}>{row.email}</td>
                <td {...stylex.props(styles.cell)}>{row.membershipCount}</td>
                <td {...stylex.props(styles.cell)}>{row.createdAt}</td>
                <td {...stylex.props(styles.cell)}>
                  <span {...stylex.props(styles.actions)}>
                    <Button variant="secondary" onPress={() => startAction("ban", row)}>
                      BAN
                    </Button>
                    <Button variant="secondary" onPress={() => startAction("unban", row)}>
                      BAN 解除
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pendingAction !== null && (
        <div
          role="alertdialog"
          aria-label={pendingAction.kind === "ban" ? "ユーザーの BAN" : "BAN の解除"}
          {...stylex.props(styles.dialog)}
        >
          <h2 {...stylex.props(styles.dialogTitle)}>
            {pendingAction.user.email} を{pendingAction.kind === "ban" ? "BAN" : "BAN 解除"}
            しますか?
          </h2>
          {actionError !== null ? (
            <p role="alert" {...stylex.props(styles.banner)}>
              {actionError}
            </p>
          ) : null}
          <span {...stylex.props(styles.actions)}>
            <Button variant="secondary" onPress={() => void confirmAction()}>
              {pendingAction.kind === "ban" ? "BAN を確定" : "解除を確定"}
            </Button>
            <Button variant="secondary" onPress={() => setPendingAction(null)}>
              キャンセル
            </Button>
          </span>
        </div>
      )}
    </>
  );
}
