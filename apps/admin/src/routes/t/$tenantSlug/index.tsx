import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Lock } from "lucide-react";
import { useMemo } from "react";
import { ICON_SIZE } from "@plyrs/ui";
import { space } from "@plyrs/ui/semantic.stylex";
import { DraftsCard, type DraftsState } from "../../../components/home/drafts-card";
import { GettingStarted, NoTypesNotice } from "../../../components/home/getting-started";
import { QuickAddRow } from "../../../components/home/quick-add-row";
import { RecentCard } from "../../../components/home/recent-card";
import { ReviewCard, type ChangedState } from "../../../components/home/review-card";
import { WidgetGrid } from "../../../components/home/widget-grid";
import { PageBody, TenantPageHeader } from "../../../components/tenant-page-header";
import { currentCrumb } from "../../../lib/breadcrumbs";
import { errorMessage } from "../../../lib/error-messages";
import {
  countByStatus,
  countChanged,
  countMyDrafts,
  homeRecords,
  homeTypes,
  myDrafts,
  recentUpdates,
  type StatusSummary,
} from "../../../lib/home";
import { HOME_LABELS, NAV_LABELS, roleLabel } from "../../../lib/labels";
import {
  meQueryOptions,
  modulesQueryOptions,
  publicationsQueryOptions,
} from "../../../lib/queries";
import { labelForRecord } from "../../../lib/record-label";
import { useSyncHasSynced, useSyncTypes, useTenantSync } from "../../../lib/sync-context";
import { useCan } from "../../../lib/use-can";
import { useRecordsOfTypes } from "../../../lib/use-collection";

const NARROW = "@media (max-width: 959px)";

const EMPTY_SUMMARY: StatusSummary = { total: 0, byType: [] };

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.lg },
  grid: {
    display: "grid",
    gridTemplateColumns: { default: "repeat(2, minmax(0, 1fr))", [NARROW]: "minmax(0, 1fr)" },
    gap: space.lg,
  },
  meta: { display: "inline-flex", alignItems: "center", gap: space.xs },
});

// b-home.md: ホーム。データの配線とレイアウトだけを持ち、見た目は components/home に置く
export const Route = createFileRoute("/t/$tenantSlug/")({
  component: HomePage,
});

function HomePage() {
  const { tenant, api, adminApi, slots } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const navigate = useNavigate();
  const sync = useTenantSync();
  const types = useSyncTypes(sync);
  const hasSynced = useSyncHasSynced(sync);
  // 裁定 B7: 自分の情報の失敗は下書きの枠だけに閉じ込める
  const me = useQuery(meQueryOptions(api));
  const modules = useQuery(modulesQueryOptions(adminApi, tenant.id));
  const publications = useQuery({
    ...publicationsQueryOptions(adminApi, tenant.id),
    enabled: hasSynced,
  });
  const canWrite = useCan("record:write");
  const canManageTypes = useCan("type:manage");

  const homeTypeList = useMemo(() => homeTypes(types, modules.data), [types, modules.data]);
  const records = useRecordsOfTypes(
    sync.registry,
    homeTypeList.map((type) => type.key),
  );
  const rows = useMemo(
    () => homeRecords(records, homeTypeList, (record) => labelForRecord(types, record)),
    [records, homeTypeList, types],
  );
  const publicationMap = useMemo(
    () =>
      new Map(
        (publications.data ?? []).map((p) => [p.recordId, { sourceVersion: p.sourceVersion }]),
      ),
    [publications.data],
  );

  // 裁定 B13: 型の一覧は同期とモジュール一覧の両方が落ち着くまで確定しない
  // (モジュール一覧の失敗は isPending を抜けるので、ホームは利用者の型だけで描かれる)
  const typesSettled = hasSynced && !modules.isPending;

  // 裁定 B6: 見出しの右はメールとロール。閲覧者は「閲覧のみ」
  const email = me.data?.email;
  const meta = canWrite ? (
    email === undefined ? (
      roleLabel(tenant.role)
    ) : (
      HOME_LABELS.meta(email, roleLabel(tenant.role))
    )
  ) : (
    <span {...stylex.props(styles.meta)}>
      <Lock size={ICON_SIZE.inline} aria-hidden="true" />
      {email === undefined ? HOME_LABELS.readOnly : HOME_LABELS.readOnlyMeta(email)}
    </span>
  );

  const widgets = slots
    .get("home:widget")
    .filter(
      (widget) =>
        widget.moduleId === undefined ||
        modules.data?.some((m) => m.moduleId === widget.moduleId && m.enabled) === true,
    );

  const userId = me.data?.userId;
  const draftsState: DraftsState = me.isError
    ? {
        kind: "error",
        message: errorMessage(me.error, HOME_LABELS.drafts.failed),
        onRetry: () => void me.refetch(),
      }
    : userId === undefined
      ? { kind: "loading" }
      : {
          kind: "ready",
          drafts: myDrafts(rows, userId),
          summary: countMyDrafts(rows, userId, homeTypeList),
        };
  const changedState: ChangedState = publications.isLoadingError
    ? { kind: "error", onRetry: () => void publications.refetch() }
    : publications.isPending
      ? { kind: "loading" }
      : { kind: "ready", summary: countChanged(rows, publicationMap, homeTypeList) };

  let content;
  if (!typesSettled) {
    // 裁定 B12: 見出しは残し、中身だけスケルトンにする
    // 閲覧者は確定後と同じく新規追加・下書きを出さない(裁定 B20)
    const loadingReview = (
      <ReviewCard
        slug={tenantSlug}
        isLoading
        inReview={EMPTY_SUMMARY}
        ready={EMPTY_SUMMARY}
        changed={{ kind: "loading" }}
      />
    );
    const loadingRecent = <RecentCard slug={tenantSlug} isLoading rows={[]} />;
    content = (
      <div aria-busy="true" {...stylex.props(styles.body)}>
        {canWrite ? (
          <>
            <QuickAddRow types={[]} onAdd={() => {}} isLoading />
            <div {...stylex.props(styles.grid)}>
              <DraftsCard slug={tenantSlug} state={{ kind: "loading" }} />
              {loadingReview}
            </div>
            {loadingRecent}
          </>
        ) : (
          <>
            {loadingReview}
            {loadingRecent}
          </>
        )}
      </div>
    );
  } else if (homeTypeList.length === 0) {
    content = canManageTypes ? (
      <GettingStarted
        siteName={tenant.name}
        onCreateType={() =>
          void navigate({
            to: "/t/$tenantSlug/settings/content-types/new",
            params: { tenantSlug },
          })
        }
        onOpenMedia={() => void navigate({ to: "/t/$tenantSlug/media", params: { tenantSlug } })}
        onInviteMembers={() =>
          void navigate({ to: "/t/$tenantSlug/settings/members", params: { tenantSlug } })
        }
      />
    ) : (
      <NoTypesNotice />
    );
  } else {
    // 裁定 B20: 新規追加と下書きは書き込める人だけ。閲覧者は確認待ちと最近の更新を並べる
    const review = (
      <ReviewCard
        slug={tenantSlug}
        inReview={countByStatus(rows, "in_review", homeTypeList)}
        ready={countByStatus(rows, "ready", homeTypeList)}
        changed={changedState}
      />
    );
    const recent = <RecentCard slug={tenantSlug} rows={recentUpdates(rows)} />;
    content = (
      <div {...stylex.props(styles.body)}>
        {canWrite ? (
          <>
            <QuickAddRow
              types={homeTypeList}
              onAdd={(typeKey) =>
                void navigate({
                  to: "/t/$tenantSlug/content/$typeKey/new",
                  params: { tenantSlug, typeKey },
                })
              }
            />
            <div {...stylex.props(styles.grid)}>
              <DraftsCard slug={tenantSlug} state={draftsState} />
              {review}
            </div>
            {recent}
          </>
        ) : (
          <>
            {review}
            {recent}
          </>
        )}
        <WidgetGrid widgets={widgets} />
      </div>
    );
  }

  return (
    <>
      <TenantPageHeader
        title={NAV_LABELS.home}
        breadcrumbs={[currentCrumb(NAV_LABELS.home)]}
        meta={meta}
      />
      <PageBody>{content}</PageBody>
    </>
  );
}
