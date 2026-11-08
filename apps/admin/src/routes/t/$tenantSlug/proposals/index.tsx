import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Banner, Button, Tabs, toaster } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { ProposalList } from "../../../../components/proposals/proposal-list";
import { PageBody, TenantPageHeader } from "../../../../components/tenant-page-header";
import { currentCrumb, homeCrumb } from "../../../../lib/breadcrumbs";
import { PROPOSAL_LABELS } from "../../../../lib/labels";
import { proposalTitle, type ProposalSummary } from "../../../../lib/proposals";
import {
  membersQueryOptions,
  openProposalsQueryOptions,
  proposalsQueryKey,
} from "../../../../lib/queries";
import { labelForRecord } from "../../../../lib/record-label";
import { useSyncTypes, useTenantSync } from "../../../../lib/sync-context";
import { useRecordsOfTypes } from "../../../../lib/use-collection";
import { useCan } from "../../../../lib/use-can";

// 16.8(M5c、決定 57): 提案の一覧。未処理 / 処理済みのタブと、record での絞り込み(編集画面の案内から来る)

const TABS = ["open", "resolved"] as const;
type Tab = (typeof TABS)[number];

type ProposalPage = { items: ProposalSummary[]; nextCursor: string | null };

export interface ProposalsSearch {
  tab?: Tab;
  recordId?: string;
}

function parseSearch(search: Record<string, unknown>): ProposalsSearch {
  const tab = TABS.find((t) => t === search["tab"]);
  const recordId = search["recordId"];
  return {
    ...(tab === undefined || tab === "open" ? {} : { tab }),
    ...(typeof recordId === "string" && recordId !== "" ? { recordId } : {}),
  };
}

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.md },
  filter: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    margin: 0,
    fontSize: font.body,
    color: text.muted,
  },
  more: { marginTop: space.sm },
});

export const Route = createFileRoute("/t/$tenantSlug/proposals/")({
  validateSearch: (search: Record<string, unknown>): ProposalsSearch => parseSearch(search),
  component: ProposalsPage,
});

function ProposalsPage() {
  const { tenant, adminApi } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const search = Route.useSearch();
  const tab: Tab = search.tab ?? "open";
  const navigate = useNavigate();
  const sync = useTenantSync();
  const types = useSyncTypes(sync);
  const canSeeMembers = useCan("member:manage");

  // 先頭ページ: 未処理・処理済みともサーバーで state と recordId に絞る(クライアントでは絞らない)。
  // 続き(「さらに表示」)はどちらも API を直接呼んで積む。タブ・絞り込み・先頭ページのどれかが変わったら積んだ続きは捨てる
  const open = useQuery(openProposalsQueryOptions(adminApi, tenant.id, search.recordId));
  const resolvedFirst = useQuery({
    queryKey: [...proposalsQueryKey(tenant.id), "resolved", search.recordId ?? null],
    queryFn: () =>
      adminApi.listProposals(tenant.id, { state: "resolved", recordId: search.recordId }),
    enabled: tab === "resolved",
    staleTime: 0,
    retry: 1,
  });
  const first = tab === "open" ? open : resolvedFirst;
  const [morePages, setMorePages] = useState<ProposalPage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreBase, setMoreBase] = useState<{
    tab: Tab;
    recordId: string | undefined;
    data: unknown;
  }>({ tab, recordId: search.recordId, data: first.data });
  if (
    moreBase.tab !== tab ||
    moreBase.recordId !== search.recordId ||
    moreBase.data !== first.data
  ) {
    setMoreBase({ tab, recordId: search.recordId, data: first.data });
    setMorePages([]);
  }

  const members = useQuery({ ...membersQueryOptions(adminApi, tenant.id), enabled: canSeeMembers });

  const items = useMemo(
    () => [...(first.data?.items ?? []), ...morePages.flatMap((p) => p.items)],
    [first.data, morePages],
  );
  const lastPage = morePages[morePages.length - 1] ?? first.data;
  const nextCursor = lastPage?.nextCursor ?? null;

  const typeKeys = useMemo(() => [...new Set(items.map((p) => p.type))].toSorted(), [items]);
  const records = useRecordsOfTypes(sync.registry, typeKeys);
  const titleOf = (proposal: ProposalSummary) => {
    const definition = types.find((type) => type.key === proposal.type);
    const record = records.find((r) => r.id === proposal.recordId);
    return proposalTitle(
      proposal,
      definition,
      record === undefined ? undefined : labelForRecord(types, record),
    );
  };

  async function loadMore() {
    if (nextCursor === null) return;
    const base = first.data;
    setLoadingMore(true);
    try {
      const page = await adminApi.listProposals(tenant.id, {
        state: tab === "open" ? "open" : "resolved",
        recordId: search.recordId,
        cursor: nextCursor,
      });
      // 取得中に先頭ページが取り直されていたら、古い続きは積まない
      if (base === first.data) setMorePages((pages) => [...pages, page]);
    } catch {
      toaster.error(PROPOSAL_LABELS.loadMoreFailed);
    } finally {
      setLoadingMore(false);
    }
  }

  const query = first;
  const breadcrumbs = [homeCrumb(tenantSlug), currentCrumb(PROPOSAL_LABELS.crumb)];

  return (
    <>
      <TenantPageHeader title={PROPOSAL_LABELS.title} breadcrumbs={breadcrumbs} />
      <PageBody>
        <div {...stylex.props(styles.stack)}>
          {search.recordId !== undefined && (
            <p {...stylex.props(styles.filter)}>
              {PROPOSAL_LABELS.filteredBy}
              <Button
                variant="link"
                size="sm"
                onPress={() =>
                  void navigate({
                    to: "/t/$tenantSlug/proposals",
                    params: { tenantSlug },
                    search: tab === "open" ? {} : { tab },
                  })
                }
              >
                {PROPOSAL_LABELS.clearFilter}
              </Button>
            </p>
          )}
          <Tabs
            label={PROPOSAL_LABELS.tabsName}
            items={TABS.map((id) => ({
              id,
              label: PROPOSAL_LABELS.tabs[id],
              ...(id === "open" && open.data !== undefined
                ? {
                    count: open.data.openCount,
                  }
                : {}),
            }))}
            selectedKey={tab}
            keyboardActivation="manual"
            onSelectionChange={(id) => {
              const next = TABS.find((t) => t === id);
              if (next === undefined) return;
              void navigate({
                to: "/t/$tenantSlug/proposals",
                params: { tenantSlug },
                search: {
                  ...(next === "open" ? {} : { tab: next }),
                  ...(search.recordId === undefined ? {} : { recordId: search.recordId }),
                },
              });
            }}
          >
            {() =>
              query.isError && query.data === undefined ? (
                <Banner tone="danger">
                  {PROPOSAL_LABELS.loadFailed}{" "}
                  <Button variant="link" size="sm" onPress={() => void query.refetch()}>
                    {PROPOSAL_LABELS.retry}
                  </Button>
                </Banner>
              ) : query.isPending ? null : (
                <>
                  <ProposalList
                    items={items}
                    hrefOf={(p) => `/t/${tenantSlug}/proposals/${p.id}`}
                    titleOf={titleOf}
                    members={members.data}
                    emptyMessage={
                      tab === "open" ? PROPOSAL_LABELS.empty : PROPOSAL_LABELS.emptyResolved
                    }
                  />
                  {nextCursor !== null && (
                    <div {...stylex.props(styles.more)}>
                      <Button
                        variant="secondary"
                        size="sm"
                        isDisabled={loadingMore}
                        onPress={() => void loadMore()}
                      >
                        {PROPOSAL_LABELS.loadMore}
                      </Button>
                    </div>
                  )}
                </>
              )
            }
          </Tabs>
        </div>
      </PageBody>
    </>
  );
}
