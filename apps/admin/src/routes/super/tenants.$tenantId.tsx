import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Checkbox } from "@plyrs/ui";
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
  opBlock: { marginTop: spacing.lg },
  opTitle: { fontSize: typography.sizeMd, fontWeight: 600, marginBottom: spacing.xs },
  notice: { color: colors.text, fontSize: typography.sizeMd, fontWeight: 600 },
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

interface HealthReport {
  archivedPublished: { recordId: string; type: string; publishedAt: string }[];
  legacyAssetType: boolean;
  legacyRichtextRecords: { recordId: string; type: string; fieldKey: string }[];
}

interface OrphanRow {
  key: string;
  size: number;
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

  // 走査系(health / orphan)はボタン起動の useMutation にする — useQuery の自動 refetch に
  // 乗せると DO をフルスキャンで無駄に起こしてしまう(design-spec: DO はオンデマンド呼び出し前提)。
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const healthMutation = useMutation({
    mutationFn: () => superApi.get<HealthReport>(`/super/v1/tenants/${tenantId}/health`),
  });

  async function runHealthCheck() {
    setHealthError(null);
    try {
      setHealthReport(await healthMutation.mutateAsync());
    } catch {
      setHealthError("健全性チェックに失敗しました");
    }
  }

  const [orphans, setOrphans] = useState<OrphanRow[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [orphanError, setOrphanError] = useState<string | null>(null);
  const orphanScanMutation = useMutation({
    mutationFn: () =>
      superApi.get<{ orphans: OrphanRow[] }>(`/super/v1/tenants/${tenantId}/orphan-assets`),
  });

  async function scanOrphans() {
    setOrphanError(null);
    try {
      const { orphans: rows } = await orphanScanMutation.mutateAsync();
      setOrphans(rows);
      setSelectedKeys(new Set());
    } catch {
      setOrphanError("孤児アセットの走査に失敗しました");
    }
  }

  function toggleOrphanKey(key: string, isSelected: boolean) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (isSelected) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  const [orphanDeleteConfirm, setOrphanDeleteConfirm] = useState(false);
  const [orphanDeleteError, setOrphanDeleteError] = useState<string | null>(null);
  const orphanDeleteMutation = useMutation({
    mutationFn: (keys: string[]) =>
      superApi.delete<{ ok: boolean; deleted: number }>(
        `/super/v1/tenants/${tenantId}/orphan-assets`,
        { keys },
      ),
  });

  async function confirmOrphanDelete() {
    setOrphanDeleteError(null);
    try {
      const keys = Array.from(selectedKeys);
      await orphanDeleteMutation.mutateAsync(keys);
      setOrphans((prev) => prev?.filter((row) => !selectedKeys.has(row.key)) ?? null);
      setSelectedKeys(new Set());
      setOrphanDeleteConfirm(false);
    } catch {
      setOrphanDeleteError("削除できませんでした");
    }
  }

  const [reprojectConfirm, setReprojectConfirm] = useState(false);
  const [reprojectError, setReprojectError] = useState<string | null>(null);
  const [reprojectEpoch, setReprojectEpoch] = useState<number | null>(null);
  const reprojectMutation = useMutation({
    mutationFn: () =>
      superApi.post<{ ok: boolean; epoch: number }>(`/super/v1/tenants/${tenantId}/reproject`),
  });

  async function confirmReproject() {
    setReprojectError(null);
    try {
      const result = await reprojectMutation.mutateAsync();
      setReprojectEpoch(result.epoch);
      setReprojectConfirm(false);
    } catch {
      setReprojectError("再投影を開始できませんでした");
    }
  }

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

      <section {...stylex.props(styles.section)}>
        <h2 {...stylex.props(styles.subtitle)}>運用</h2>

        <div {...stylex.props(styles.opBlock)}>
          <h3 {...stylex.props(styles.opTitle)}>健全性チェック</h3>
          <Button
            variant="secondary"
            isDisabled={healthMutation.isPending}
            onPress={() => void runHealthCheck()}
          >
            健全性チェックを実行
          </Button>
          {healthError !== null ? (
            <p role="alert" {...stylex.props(styles.banner)}>
              {healthError}
            </p>
          ) : null}
          {healthReport !== null && (
            <>
              {healthReport.archivedPublished.length === 0 ? (
                <p {...stylex.props(styles.muted)}>archived かつ公開中のレコードはありません</p>
              ) : (
                <table {...stylex.props(styles.table)}>
                  <caption {...stylex.props(styles.caption)}>archived かつ公開中のレコード</caption>
                  <thead>
                    <tr>
                      <th {...stylex.props(styles.cell)}>レコードID</th>
                      <th {...stylex.props(styles.cell)}>型</th>
                      <th {...stylex.props(styles.cell)}>公開日時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {healthReport.archivedPublished.map((row) => (
                      <tr key={row.recordId}>
                        <td {...stylex.props(styles.cell)}>{row.recordId}</td>
                        <td {...stylex.props(styles.cell)}>{row.type}</td>
                        <td {...stylex.props(styles.cell)}>{row.publishedAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {healthReport.legacyAssetType ? (
                <p role="alert" {...stylex.props(styles.banner)}>
                  旧形式の asset 型が検出されました
                </p>
              ) : null}
              {healthReport.legacyRichtextRecords.length === 0 ? (
                <p {...stylex.props(styles.muted)}>旧形式の richtext を含むレコードはありません</p>
              ) : (
                <table {...stylex.props(styles.table)}>
                  <caption {...stylex.props(styles.caption)}>
                    旧形式の richtext を含むレコード
                  </caption>
                  <thead>
                    <tr>
                      <th {...stylex.props(styles.cell)}>レコードID</th>
                      <th {...stylex.props(styles.cell)}>型</th>
                      <th {...stylex.props(styles.cell)}>フィールド</th>
                    </tr>
                  </thead>
                  <tbody>
                    {healthReport.legacyRichtextRecords.map((row) => (
                      <tr key={`${row.recordId}:${row.fieldKey}`}>
                        <td {...stylex.props(styles.cell)}>{row.recordId}</td>
                        <td {...stylex.props(styles.cell)}>{row.type}</td>
                        <td {...stylex.props(styles.cell)}>{row.fieldKey}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        <div {...stylex.props(styles.opBlock)}>
          <h3 {...stylex.props(styles.opTitle)}>孤児アセット</h3>
          <Button
            variant="secondary"
            isDisabled={orphanScanMutation.isPending}
            onPress={() => void scanOrphans()}
          >
            孤児アセットを走査
          </Button>
          {orphanError !== null ? (
            <p role="alert" {...stylex.props(styles.banner)}>
              {orphanError}
            </p>
          ) : null}
          {orphans !== null &&
            (orphans.length === 0 ? (
              <p {...stylex.props(styles.muted)}>孤児アセットはありません</p>
            ) : (
              <>
                <table {...stylex.props(styles.table)}>
                  <caption {...stylex.props(styles.caption)}>孤児アセットの一覧</caption>
                  <thead>
                    <tr>
                      <th {...stylex.props(styles.cell)}>キー</th>
                      <th {...stylex.props(styles.cell)}>サイズ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orphans.map((row) => (
                      <tr key={row.key}>
                        <td {...stylex.props(styles.cell)}>
                          <Checkbox
                            isSelected={selectedKeys.has(row.key)}
                            onChange={(isSelected) => toggleOrphanKey(row.key, isSelected)}
                          >
                            {row.key}
                          </Checkbox>
                        </td>
                        <td {...stylex.props(styles.cell)}>{row.size}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Button
                  variant="secondary"
                  isDisabled={selectedKeys.size === 0}
                  onPress={() => setOrphanDeleteConfirm(true)}
                >
                  選択を削除
                </Button>
              </>
            ))}
          {orphanDeleteConfirm && (
            <div
              role="alertdialog"
              aria-label="孤児アセットの削除"
              {...stylex.props(styles.dialog)}
            >
              <h3 {...stylex.props(styles.dialogTitle)}>
                選択した {selectedKeys.size} 件を削除しますか?
              </h3>
              {orphanDeleteError !== null ? (
                <p role="alert" {...stylex.props(styles.banner)}>
                  {orphanDeleteError}
                </p>
              ) : null}
              <span {...stylex.props(styles.actions)}>
                <Button
                  variant="secondary"
                  isDisabled={orphanDeleteMutation.isPending}
                  onPress={() => void confirmOrphanDelete()}
                >
                  削除を確定
                </Button>
                <Button variant="secondary" onPress={() => setOrphanDeleteConfirm(false)}>
                  キャンセル
                </Button>
              </span>
            </div>
          )}
        </div>

        <div {...stylex.props(styles.opBlock)}>
          <h3 {...stylex.props(styles.opTitle)}>再投影</h3>
          <Button variant="secondary" onPress={() => setReprojectConfirm(true)}>
            再投影を開始
          </Button>
          {reprojectEpoch !== null ? (
            <p {...stylex.props(styles.notice)}>再投影を開始しました(epoch: {reprojectEpoch})</p>
          ) : null}
          {reprojectConfirm && (
            <div role="alertdialog" aria-label="再投影の確認" {...stylex.props(styles.dialog)}>
              <h3 {...stylex.props(styles.dialogTitle)}>このテナントを再投影しますか?</h3>
              {reprojectError !== null ? (
                <p role="alert" {...stylex.props(styles.banner)}>
                  {reprojectError}
                </p>
              ) : null}
              <span {...stylex.props(styles.actions)}>
                <Button
                  variant="secondary"
                  isDisabled={reprojectMutation.isPending}
                  onPress={() => void confirmReproject()}
                >
                  開始を確定
                </Button>
                <Button variant="secondary" onPress={() => setReprojectConfirm(false)}>
                  キャンセル
                </Button>
              </span>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
