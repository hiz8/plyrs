import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0, marginBottom: 0 },
  slug: { color: colors.textMuted, fontSize: typography.sizeMd, marginTop: 0 },
  muted: { color: colors.textMuted },
  banner: { color: colors.danger, fontSize: typography.sizeMd, margin: 0 },
  section: { marginTop: spacing.xl },
  subtitle: { fontSize: typography.sizeLg, marginBottom: spacing.sm },
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
  actions: { display: "flex", gap: spacing.sm },
});

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  memberCount: number;
}

interface MemberRow {
  userId: string;
  email: string;
  role: string;
  createdAt: string;
}

export const Route = createFileRoute("/super/tenants/$tenantId")({
  component: TenantDetailPage,
});

function TenantDetailPage() {
  const { superApi } = Route.useRouteContext();
  const { tenantId } = Route.useParams();
  const queryClient = useQueryClient();

  // テナント単体を返す専用エンドポイントは無い(§超 API 契約)ため一覧を引いて絞り込む。
  // 一覧ページ(super/index.tsx)と同じ queryKey を共有し、遷移直後はキャッシュから即描画できる。
  const tenants = useQuery({
    queryKey: ["super", "tenants"],
    queryFn: () => superApi.get<{ tenants: TenantRow[] }>("/super/v1/tenants"),
  });
  const tenant = tenants.data?.tenants.find((row) => row.id === tenantId);

  const membersKey = ["super", "tenants", tenantId, "members"];
  const members = useQuery({
    queryKey: membersKey,
    queryFn: () => superApi.get<{ members: MemberRow[] }>(`/super/v1/tenants/${tenantId}/members`),
  });

  const [revokeTarget, setRevokeTarget] = useState<MemberRow | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const revokeMutation = useMutation({
    mutationFn: (userId: string) =>
      superApi.delete<{ ok: boolean; disconnected: number }>(
        `/super/v1/tenants/${tenantId}/members/${userId}`,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: membersKey }),
  });

  function startRevoke(member: MemberRow) {
    setRevokeTarget(member);
    setRevokeError(null);
  }

  async function confirmRevoke() {
    if (revokeTarget === null) {
      return;
    }
    setRevokeError(null);
    try {
      await revokeMutation.mutateAsync(revokeTarget.userId);
      setRevokeTarget(null);
    } catch {
      setRevokeError("剥奪に失敗しました");
    }
  }

  const memberRows = members.data?.members ?? [];

  return (
    <>
      <h1 {...stylex.props(styles.title)}>{tenant?.name ?? "テナント詳細"}</h1>
      <p {...stylex.props(styles.slug)}>{tenant?.slug ?? tenantId}</p>

      <section {...stylex.props(styles.section)}>
        <h2 {...stylex.props(styles.subtitle)}>メンバー</h2>
        {members.isError ? (
          <p role="alert" {...stylex.props(styles.banner)}>
            メンバー一覧を取得できませんでした
          </p>
        ) : null}
        {members.isPending ? (
          <p {...stylex.props(styles.muted)}>読み込み中…</p>
        ) : memberRows.length === 0 ? (
          <p {...stylex.props(styles.muted)}>メンバーはいません</p>
        ) : (
          <table {...stylex.props(styles.table)}>
            <caption {...stylex.props(styles.caption)}>所属メンバーの一覧</caption>
            <thead>
              <tr>
                <th {...stylex.props(styles.cell)}>メール</th>
                <th {...stylex.props(styles.cell)}>役割</th>
                <th {...stylex.props(styles.cell)}>参加日</th>
                <th {...stylex.props(styles.cell)}>操作</th>
              </tr>
            </thead>
            <tbody>
              {memberRows.map((member) => (
                <tr key={member.userId}>
                  <td {...stylex.props(styles.cell)}>{member.email}</td>
                  <td {...stylex.props(styles.cell)}>{member.role}</td>
                  <td {...stylex.props(styles.cell)}>{member.createdAt}</td>
                  <td {...stylex.props(styles.cell)}>
                    <Button variant="secondary" onPress={() => startRevoke(member)}>
                      剥奪
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {revokeTarget !== null && (
          <div role="alertdialog" aria-label="メンバーの剥奪" {...stylex.props(styles.dialog)}>
            <h3 {...stylex.props(styles.dialogTitle)}>
              {revokeTarget.email} をこのテナントから外しますか?
            </h3>
            {revokeError !== null ? (
              <p role="alert" {...stylex.props(styles.banner)}>
                {revokeError}
              </p>
            ) : null}
            <span {...stylex.props(styles.actions)}>
              <Button variant="secondary" onPress={() => void confirmRevoke()}>
                剥奪を確定
              </Button>
              <Button variant="secondary" onPress={() => setRevokeTarget(null)}>
                キャンセル
              </Button>
            </span>
          </div>
        )}
      </section>

      {/* Task 14: このテナントの health / orphan asset / reproject 操作をここに追加する */}
      <section {...stylex.props(styles.section)}>
        <h2 {...stylex.props(styles.subtitle)}>運用</h2>
        <p {...stylex.props(styles.muted)}>健全性チェック・孤児アセット・再投影は準備中です</p>
      </section>
    </>
  );
}
