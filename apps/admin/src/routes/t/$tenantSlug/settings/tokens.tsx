import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Button, toaster } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { CardError, CardLoading } from "../../../../components/settings/card-state";
import { CopyField } from "../../../../components/settings/copy-field";
import {
  IssueTokenDialog,
  type IssueTokenFailure,
} from "../../../../components/settings/issue-token-dialog";
import { RevokeTokenDialog } from "../../../../components/settings/revoke-token-dialog";
import { SettingsCard } from "../../../../components/settings/settings-card";
import { SettingsFrame } from "../../../../components/settings/settings-frame";
import { TokensTable } from "../../../../components/settings/tokens-table";
import type { IssuedToken, IssueTokenInput } from "../../../../lib/admin-api";
import { ApiError } from "../../../../lib/api-client";
import { errorMessage } from "../../../../lib/error-messages";
import { TOKEN_LABELS } from "../../../../lib/labels";
import { isRole } from "../../../../lib/api-contracts";
import { resolvePublicOrigin } from "../../../../lib/public-api";
import {
  configQueryOptions,
  grantsQueryOptions,
  tokensQueryOptions,
} from "../../../../lib/queries";
import {
  canManageTokens,
  type ConnectionRow,
  connectionRows,
  mcpEndpoint,
} from "../../../../lib/tokens";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.md },
  empty: { margin: 0, fontSize: font.body, color: text.muted },
  note: { margin: 0, fontSize: font.caption, color: text.muted },
});

// 接続中のアプリ(PAT と OAuth の付与)は管理者だけ(design-spec 16.3・16.12)。settings/route.tsx の
// site:manage より狭い member:manage で見る。API 側も同じ判定で 403 を返す
export const Route = createFileRoute("/t/$tenantSlug/settings/tokens")({
  beforeLoad: ({ context, params }) => {
    if (!canManageTokens(context.tenant.role)) {
      throw redirect({ to: "/t/$tenantSlug", params });
    }
  },
  component: TokensPage,
});

function issueFailureOf(cause: unknown): IssueTokenFailure {
  if (cause instanceof ApiError && cause.code === "expiry_too_long") {
    return { kind: "expiry_too_long" };
  }
  return { kind: "other", message: errorMessage(cause, TOKEN_LABELS.issueDialog.failed) };
}

function TokensPage() {
  const { tenant, api, adminApi, queryClient } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const labels = TOKEN_LABELS;
  const tokens = useQuery(tokensQueryOptions(adminApi, tenant.id));
  const grants = useQuery(grantsQueryOptions(adminApi, tenant.id));
  const config = useQuery(configQueryOptions(api));
  const role = isRole(tenant.role) ? tenant.role : "viewer";

  const [isIssueOpen, setIssueOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [issueFailure, setIssueFailure] = useState<IssueTokenFailure>(null);
  const [revokeTarget, setRevokeTarget] = useState<ConnectionRow | null>(null);

  const invalidateTokens = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tokens", tenant.id] }),
      queryClient.invalidateQueries({ queryKey: ["grants", tenant.id] }),
    ]);

  const issue = useMutation({
    mutationFn: (input: IssueTokenInput) => adminApi.issueToken(tenant.id, input),
    onSuccess: (result) => {
      void invalidateTokens();
      setIssueFailure(null);
      // token はこの応答にしか現れない。ダイアログを閉じるまで表示する
      setIssued(result);
    },
    onError: (cause) => setIssueFailure(issueFailureOf(cause)),
  });

  const revoke = useMutation({
    mutationFn: (row: ConnectionRow) =>
      row.kind === "pat"
        ? adminApi.revokeToken(tenant.id, row.token.id)
        : adminApi.revokeGrant(tenant.id, row.grant.userId, row.grant.id),
    onSuccess: (_result, row) => {
      void invalidateTokens();
      toaster.success(labels.revoked(row.name));
    },
    onError: (cause) => {
      void invalidateTokens();
      toaster.error(errorMessage(cause, labels.revokeFailed));
    },
    onSettled: () => setRevokeTarget(null),
  });

  const rows = connectionRows(tokens.data ?? [], grants.data ?? [], new Date());

  let connect;
  if (config.isLoadingError) {
    connect = <CardError message={labels.loadFailed} onRetry={() => void config.refetch()} />;
  } else if (config.data === undefined) {
    connect = <CardLoading rows={2} />;
  } else {
    const origin = resolvePublicOrigin(config.data.publicApiOrigin, window.location.origin);
    connect = (
      <div {...stylex.props(styles.stack)}>
        <CopyField label={labels.connect.endpoint} value={mcpEndpoint(origin, tenant.id)} />
        <CopyField label={labels.connect.header} value={labels.connect.headerValue} />
        <p {...stylex.props(styles.note)}>{labels.connect.limited}</p>
      </div>
    );
  }

  return (
    <SettingsFrame
      tab="tokens"
      slug={tenantSlug}
      primaryAction={
        <Button
          variant="primary"
          icon={Plus}
          onPress={() => {
            setIssueFailure(null);
            setIssued(null);
            setIssueOpen(true);
          }}
        >
          {labels.issue}
        </Button>
      }
      isLoading={tokens.isPending || grants.isPending}
      // OAuth の付与の取得だけ失敗しても PAT の一覧は隠さない(表の下に別で知らせる)
      error={
        tokens.isLoadingError
          ? {
              message: errorMessage(tokens.error, labels.loadFailed),
              onRetry: () => void tokens.refetch(),
            }
          : undefined
      }
    >
      {rows.length === 0 ? (
        <p {...stylex.props(styles.empty)}>{labels.empty}</p>
      ) : (
        <TokensTable rows={rows} onRevoke={setRevokeTarget} isBusy={revoke.isPending} />
      )}
      {grants.isLoadingError ? (
        <CardError message={labels.grantsLoadFailed} onRetry={() => void grants.refetch()} />
      ) : null}
      <SettingsCard title={labels.connect.title} description={labels.connect.description}>
        {connect}
      </SettingsCard>
      <IssueTokenDialog
        isOpen={isIssueOpen}
        role={role}
        issued={issued}
        onOpenChange={(open) => {
          setIssueOpen(open);
          if (!open) {
            setIssueFailure(null);
            setIssued(null);
          }
        }}
        onSubmit={(input) => issue.mutate(input)}
        isPending={issue.isPending}
        failure={issueFailure}
      />
      <RevokeTokenDialog
        target={revokeTarget}
        onConfirm={() => {
          if (revokeTarget !== null) revoke.mutate(revokeTarget);
        }}
        onCancel={() => setRevokeTarget(null)}
        isPending={revoke.isPending}
      />
    </SettingsFrame>
  );
}
