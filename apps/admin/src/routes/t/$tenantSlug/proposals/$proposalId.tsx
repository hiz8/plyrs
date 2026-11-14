import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Banner, Button, toaster } from "@plyrs/ui";
import { bg, font, radius, space, text } from "@plyrs/ui/semantic.stylex";
import { ProposalDiff } from "./-components/proposal-diff";
import { kindTone } from "./-components/proposal-list";
import { AcceptProposalDialog, RejectProposalDialog } from "./-components/resolve-dialogs";
import { PageBody, PageLoading, TenantPageHeader } from "~/components/tenant-page-header";
import { currentCrumb, homeCrumb, proposalsCrumb } from "~/lib/breadcrumbs";
import { formatDateTime } from "~/lib/datetime";
import { errorCodeOf, errorMessage } from "~/lib/error-messages";
import { actorLabel, viaLabel } from "~/features/records";
import { PROPOSAL_LABELS } from "~/lib/labels";
import {
  acceptOperationFor,
  kindLabel,
  proposalTitle,
  stateLabel,
  summarizeProposal,
} from "./-lib/proposals";
import {
  membersQueryOptions,
  proposalQueryOptions,
  proposalsQueryKey,
  publicationQueryOptions,
  publicationsQueryKey,
} from "~/lib/queries";
import { labelForRecord } from "~/lib/record-label";
import { useSyncTypes, useTenantSync } from "~/lib/sync-context";
import { useCan } from "~/lib/use-can";
import { useCollectionRows } from "~/lib/use-collection";

// 16.8(M5c、決定 57): 提案の詳細。差分を見て採用・却下する。採用は自分(採用する人)の名前で書き込まれる

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.md },
  meta: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: space.md,
    rowGap: space.xs,
    margin: 0,
    padding: space.md,
    borderRadius: radius.container,
    backgroundColor: bg.surface,
    fontSize: font.body,
  },
  dt: { margin: 0, color: text.muted },
  dd: { margin: 0, color: text.default, overflowWrap: "anywhere" },
  row: { display: "flex", alignItems: "center", gap: space.xs, flexWrap: "wrap" },
  note: { whiteSpace: "pre-wrap" },
  actions: { display: "flex", gap: space.sm, flexWrap: "wrap" },
  muted: { margin: 0, fontSize: font.body, color: text.muted },
});

export const Route = createFileRoute("/t/$tenantSlug/proposals/$proposalId")({
  component: ProposalPage,
});

function ProposalPage() {
  const { tenant, adminApi, queryClient } = Route.useRouteContext();
  const { tenantSlug, proposalId } = Route.useParams();
  const navigate = useNavigate();
  const sync = useTenantSync();
  const types = useSyncTypes(sync);
  const canSeeMembers = useCan("member:manage");
  const canWrite = useCan("record:write");
  const canDelete = useCan("record:delete");
  const canPublish = useCan("record:publish");

  const proposal = useQuery(proposalQueryOptions(adminApi, tenant.id, proposalId));
  const members = useQuery({ ...membersQueryOptions(adminApi, tenant.id), enabled: canSeeMembers });
  const records = useCollectionRows(
    proposal.data === undefined ? undefined : sync.registry.get(proposal.data.type),
  );
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const breadcrumbs = [homeCrumb(tenantSlug), proposalsCrumb(tenantSlug)];
  if (proposal.isPending) {
    return <PageLoading breadcrumbs={breadcrumbs} />;
  }
  if (proposal.isError || proposal.data === undefined) {
    const notFound = errorCodeOf(proposal.error) === "not_found";
    return (
      <>
        <TenantPageHeader
          title={PROPOSAL_LABELS.title}
          breadcrumbs={[...breadcrumbs, currentCrumb(PROPOSAL_LABELS.crumb)]}
        />
        <PageBody>
          <Banner tone="danger">
            {notFound ? PROPOSAL_LABELS.notFound : PROPOSAL_LABELS.loadFailed}{" "}
            {!notFound && (
              <Button variant="link" size="sm" onPress={() => void proposal.refetch()}>
                {PROPOSAL_LABELS.retry}
              </Button>
            )}
          </Banner>
        </PageBody>
      </>
    );
  }

  const detail = proposal.data;
  const definition = types.find((type) => type.key === detail.type);
  const record = records.find((r) => r.id === detail.recordId);
  const title = proposalTitle(
    detail,
    definition,
    record === undefined ? undefined : labelForRecord(types, record),
  );
  const summary = summarizeProposal(detail, members.data);
  const canAccept = (() => {
    switch (acceptOperationFor(detail.kind)) {
      case "record:write":
        return canWrite;
      case "record:delete":
        return canDelete;
      case "record:publish":
        return canPublish;
    }
  })();

  async function invalidateAfterResolve() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: proposalsQueryKey(tenant.id) }),
      queryClient.invalidateQueries({
        queryKey: publicationQueryOptions(adminApi, tenant.id, detail.recordId).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: publicationsQueryKey(tenant.id) }),
      queryClient.invalidateQueries({ queryKey: ["history", tenant.id, detail.recordId] }),
    ]);
  }

  async function accept() {
    setPending(true);
    try {
      await adminApi.acceptProposal(tenant.id, proposalId);
    } catch (cause) {
      toaster.error(errorMessage(cause, PROPOSAL_LABELS.acceptFailed));
      setPending(false);
      setAcceptOpen(false);
      await queryClient.invalidateQueries({ queryKey: proposalsQueryKey(tenant.id) });
      return;
    }
    setPending(false);
    setAcceptOpen(false);
    toaster.success(PROPOSAL_LABELS.accepted);
    await invalidateAfterResolve();
    await navigate({ to: "/t/$tenantSlug/proposals", params: { tenantSlug }, search: {} });
  }

  async function reject(reason: string) {
    setPending(true);
    try {
      await adminApi.rejectProposal(tenant.id, proposalId, reason === "" ? undefined : reason);
    } catch (cause) {
      toaster.error(errorMessage(cause, PROPOSAL_LABELS.rejectFailed));
      setPending(false);
      setRejectOpen(false);
      await queryClient.invalidateQueries({ queryKey: proposalsQueryKey(tenant.id) });
      return;
    }
    setPending(false);
    setRejectOpen(false);
    toaster.success(PROPOSAL_LABELS.rejected);
    await invalidateAfterResolve();
    await navigate({ to: "/t/$tenantSlug/proposals", params: { tenantSlug }, search: {} });
  }

  const resolved = detail.state !== "open";
  return (
    <>
      <TenantPageHeader title={title} breadcrumbs={[...breadcrumbs, currentCrumb(title)]} />
      <PageBody>
        <div {...stylex.props(styles.stack)}>
          <div {...stylex.props(styles.row)}>
            <Badge tone={kindTone(detail.kind)}>{kindLabel(detail.kind)}</Badge>
            <Badge tone={detail.state === "accepted" ? "success" : "neutral"}>
              {stateLabel(detail.state)}
            </Badge>
            {detail.type !== "" && <Badge isMonospace>{detail.type}</Badge>}
          </div>
          {detail.stale && !resolved && (
            <Banner tone="warning">
              {PROPOSAL_LABELS.stale}。{PROPOSAL_LABELS.staleHelp}
            </Banner>
          )}
          <dl {...stylex.props(styles.meta)}>
            <dt {...stylex.props(styles.dt)}>{PROPOSAL_LABELS.proposer}</dt>
            <dd {...stylex.props(styles.dd)}>{actorLabel(detail.actor, members.data)}</dd>
            <dt {...stylex.props(styles.dt)}>{PROPOSAL_LABELS.via}</dt>
            <dd {...stylex.props(styles.dd)}>{viaLabel(detail.via)}</dd>
            <dt {...stylex.props(styles.dt)}>{PROPOSAL_LABELS.createdAt}</dt>
            <dd {...stylex.props(styles.dd)}>{formatDateTime(detail.createdAt).absolute}</dd>
            <dt {...stylex.props(styles.dt)}>{PROPOSAL_LABELS.note}</dt>
            <dd {...stylex.props(styles.dd, styles.note)}>
              {detail.note ?? PROPOSAL_LABELS.noNote}
            </dd>
            {resolved && detail.resolvedBy !== null && detail.resolvedAt !== null && (
              <>
                <dt {...stylex.props(styles.dt)}>{PROPOSAL_LABELS.stateHeading}</dt>
                <dd {...stylex.props(styles.dd)}>
                  {PROPOSAL_LABELS.resolvedBy(
                    detail.state === "accepted" ? "accepted" : "rejected",
                    actorLabel(detail.resolvedBy, members.data),
                    formatDateTime(detail.resolvedAt).absolute,
                  )}
                  {detail.resolutionNote !== null && detail.resolutionNote !== "" && (
                    <> ({detail.resolutionNote})</>
                  )}
                </dd>
              </>
            )}
          </dl>
          <ProposalDiff
            kind={detail.kind}
            fields={detail.fields}
            definition={definition}
            status={detail.status}
            currentStatus={detail.currentStatus}
          />
          <div {...stylex.props(styles.actions)}>
            {!resolved && canAccept && (
              <Button variant="primary" onPress={() => setAcceptOpen(true)}>
                {PROPOSAL_LABELS.accept}
              </Button>
            )}
            {!resolved && canWrite && (
              <Button variant="secondary" onPress={() => setRejectOpen(true)}>
                {PROPOSAL_LABELS.reject}
              </Button>
            )}
            {detail.kind !== "create" && record !== undefined && (
              <Button
                variant="secondary"
                onPress={() =>
                  void navigate({
                    to: "/t/$tenantSlug/content/$typeKey/$recordId",
                    params: { tenantSlug, typeKey: detail.type, recordId: detail.recordId },
                  })
                }
              >
                {PROPOSAL_LABELS.openRecord}
              </Button>
            )}
          </div>
        </div>
      </PageBody>
      <AcceptProposalDialog
        kind={detail.kind}
        summary={summary}
        isOpen={acceptOpen}
        onOpenChange={setAcceptOpen}
        isPending={pending}
        onConfirm={() => void accept()}
      />
      <RejectProposalDialog
        isOpen={rejectOpen}
        onOpenChange={setRejectOpen}
        isPending={pending}
        onConfirm={(reason) => void reject(reason)}
      />
    </>
  );
}
