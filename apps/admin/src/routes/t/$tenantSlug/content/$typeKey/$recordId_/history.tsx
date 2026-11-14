import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { Collection } from "@tanstack/db";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { Banner, Button, ConfirmDialog, toaster } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { HistoryDiff } from "./-components/history-diff";
import { HistoryList } from "./-components/history-list";
import { PageBody, PageLoading, TenantPageHeader } from "~/components/tenant-page-header";
import { contentTypeCrumb, currentCrumb, homeCrumb } from "~/lib/breadcrumbs";
import { errorMessage } from "~/lib/error-messages";
import { summarizeEntry, type HistorySelection } from "~/features/records";
import type { HistoryEntry } from "~/lib/api-contracts";
import { EDITOR_LABELS, HISTORY_LABELS } from "~/lib/labels";
import { membersQueryOptions, publicationQueryOptions } from "~/lib/queries";
import { useSyncHasSynced, useSyncTypes, useTenantSync } from "~/lib/sync-context";
import { useCan } from "~/lib/use-can";

// 幅 960px 未満では 1 列にする(record-editor.tsx と同じ境界)
const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  layout: {
    display: "grid",
    // 部品固有の値: 左列(版の一覧)の幅
    gridTemplateColumns: { default: "320px minmax(0, 1fr)", [NARROW]: "1fr" },
    gap: space.xl,
    alignItems: "start",
  },
  muted: { margin: 0, fontSize: font.body, color: text.muted },
});

export const Route = createFileRoute("/t/$tenantSlug/content/$typeKey/$recordId_/history")({
  component: RecordHistoryPage,
});

function RecordHistoryPage() {
  const { tenant, adminApi, queryClient } = Route.useRouteContext();
  const { tenantSlug, typeKey, recordId } = Route.useParams();
  const sync = useTenantSync();
  const types = useSyncTypes(sync);
  const hasSynced = useSyncHasSynced(sync);
  const navigate = useNavigate();
  const canWrite = useCan("record:write");
  const canSeeMembers = useCan("member:manage");

  const [pages, setPages] = useState<HistoryEntry[][]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<HistorySelection | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // 復元のたびに履歴を取り直すための世代(ページの蓄積を捨てる)
  const [generation, setGeneration] = useState(0);

  const page = useQuery({
    queryKey: ["history", tenant.id, recordId, generation, cursor ?? null],
    queryFn: () => adminApi.listHistory(tenant.id, recordId, cursor),
    staleTime: 0,
    retry: 1,
  });
  // ページの蓄積は cursor ごとの照会結果を順に並べる(同じ cursor の再取得は差し替え)
  const loadedPages = page.data === undefined ? pages : upsertPage(pages, cursor, page.data.items);
  if (page.data !== undefined && loadedPages !== pages) {
    setPages(loadedPages);
  }
  const entries = loadedPages.flat();
  const nextCursor = page.data?.nextCursor ?? null;

  const publication = useQuery(publicationQueryOptions(adminApi, tenant.id, recordId));
  const members = useQuery({ ...membersQueryOptions(adminApi, tenant.id), enabled: canSeeMembers });

  const compareKey =
    selected === null ? null : selected.kind === "published" ? "published" : selected.historySeq;
  const compare = useQuery({
    queryKey: ["history-compare", tenant.id, recordId, generation, compareKey],
    queryFn: () =>
      adminApi.compareVersions(tenant.id, recordId, compareKey === null ? "published" : compareKey),
    enabled: compareKey !== null,
    staleTime: 0,
    retry: 1,
  });

  if (!hasSynced) {
    return <PageLoading breadcrumbs={[homeCrumb(tenantSlug)]} />;
  }
  const contentType = types.find((type) => type.key === typeKey);
  const breadcrumbs = [
    homeCrumb(tenantSlug),
    ...(contentType === undefined ? [] : [contentTypeCrumb(tenantSlug, contentType)]),
    {
      id: "record",
      label: EDITOR_LABELS.crumbEdit,
      href: `/t/${tenantSlug}/content/${typeKey}/${recordId}`,
    },
    currentCrumb(HISTORY_LABELS.crumb),
  ];

  const selectedEntry =
    selected?.kind === "history"
      ? entries.find((entry) => entry.historySeq === selected.historySeq)
      : undefined;

  async function confirmRestore() {
    if (selectedEntry === undefined) return;
    setRestoring(true);
    let restored: { version: number };
    try {
      restored = await adminApi.restoreVersion(tenant.id, recordId, selectedEntry.historySeq);
    } catch (cause) {
      toaster.error(errorMessage(cause, HISTORY_LABELS.restoreFailed));
      setRestoring(false);
      setRestoreOpen(false);
      return;
    }
    setRestoring(false);
    setRestoreOpen(false);
    toaster.success(HISTORY_LABELS.restored);
    // 復元は REST で行われ、編集画面は同期の record をマウント時に束縛する。同期の change が届いて
    // 手元の record が復元後の版になるのを(上限つきで)待ってから戻る
    await waitForVersion(sync.registry.get(typeKey), recordId, restored.version);
    await queryClient.invalidateQueries({
      queryKey: publicationQueryOptions(adminApi, tenant.id, recordId).queryKey,
    });
    await navigate({
      to: "/t/$tenantSlug/content/$typeKey/$recordId",
      params: { tenantSlug, typeKey, recordId },
    });
  }

  return (
    <>
      <TenantPageHeader title={HISTORY_LABELS.title} breadcrumbs={breadcrumbs} />
      <PageBody>
        {page.isError && pages.length === 0 ? (
          <Banner tone="danger">
            {HISTORY_LABELS.loadFailed}{" "}
            <Button variant="link" size="sm" onPress={() => void page.refetch()}>
              {HISTORY_LABELS.retry}
            </Button>
          </Banner>
        ) : entries.length === 0 && publication.data?.published !== true && !page.isPending ? (
          <p {...stylex.props(styles.muted)}>{HISTORY_LABELS.empty}</p>
        ) : (
          <div {...stylex.props(styles.layout)}>
            <HistoryList
              entries={entries}
              published={
                publication.data?.published === true
                  ? {
                      sourceVersion: publication.data.sourceVersion,
                      publishedAt: publication.data.publishedAt,
                    }
                  : null
              }
              selected={selected}
              onSelect={setSelected}
              members={members.data}
              hasMore={nextCursor !== null}
              isLoadingMore={page.isFetching}
              onLoadMore={() => {
                if (nextCursor !== null) setCursor(nextCursor);
              }}
            />
            <HistoryDiff
              compare={compare.data}
              isLoading={compare.isPending}
              isError={compare.isError}
              onRetry={() => void compare.refetch()}
              definition={contentType}
              canRestore={canWrite && selectedEntry !== undefined}
              onRestore={() => setRestoreOpen(true)}
              hasSelection={selected !== null}
            />
          </div>
        )}
      </PageBody>
      {selectedEntry !== undefined && (
        <ConfirmDialog
          title={HISTORY_LABELS.restoreDialog.title}
          isOpen={restoreOpen}
          onOpenChange={setRestoreOpen}
          tone="primary"
          confirmLabel={HISTORY_LABELS.restoreDialog.confirm}
          isPending={restoring}
          onConfirm={() => {
            void confirmRestore().then(() => setGeneration((n) => n + 1));
          }}
        >
          <p>{HISTORY_LABELS.restoreDialog.body(summarizeEntry(selectedEntry, members.data))}</p>
        </ConfirmDialog>
      )}
    </>
  );
}

async function waitForVersion(
  collection: Collection<SyncRecord, string> | undefined,
  recordId: string,
  version: number,
  timeoutMs = 3000,
): Promise<void> {
  if (collection === undefined) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = collection.toArray.find((candidate) => candidate.id === recordId);
    if (row !== undefined && row.version >= version) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// cursor(undefined = 先頭)ごとのページを順に積む。同じ cursor の再取得は差し替え、内容が同じなら同じ参照
function upsertPage(
  pages: HistoryEntry[][],
  cursor: string | undefined,
  items: HistoryEntry[],
): HistoryEntry[][] {
  const index =
    cursor === undefined
      ? 0
      : pages.findIndex((p) => p[p.length - 1]?.historySeq === Number(cursor)) + 1;
  if (index <= 0 && cursor !== undefined) {
    return pages; // 前のページが無い(起こらない想定)
  }
  const existing = pages[index];
  if (existing !== undefined && sameItems(existing, items)) {
    return pages;
  }
  const next = pages.slice(0, index);
  next[index] = items;
  return next;
}

function sameItems(a: HistoryEntry[], b: HistoryEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, i) => entry.historySeq === b[i]?.historySeq && entry.updatedAt === b[i]?.updatedAt,
    )
  );
}
