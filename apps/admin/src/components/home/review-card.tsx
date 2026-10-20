import * as stylex from "@stylexjs/stylex";
import { ChevronRight, CircleCheck, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { VisuallyHidden } from "react-aria-components";
import { Button, ICON_SIZE, Skeleton } from "@plyrs/ui";
import { accent, font, radius, space, status, text } from "@plyrs/ui/semantic.stylex";
import { listHref, type HomeType, type StatusSummary } from "../../lib/home";
import { HOME_LABELS } from "../../lib/labels";
import { PublicationBadge, WorkflowStatusBadge } from "../publication-badge";
import { CardEmpty, CardLoadingRows, CardRow, HomeCard, TypeLinks } from "./home-card";

// b-home.md 2.3: 件数チップは 24px の角丸
const COUNT_SIZE = "24px";

const styles = stylex.create({
  description: { flex: 1, minWidth: 0, fontSize: font.caption, color: text.muted },
  count: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: COUNT_SIZE,
    height: COUNT_SIZE,
    paddingInline: space.xs,
    boxSizing: "border-box",
    borderRadius: radius.full,
    backgroundColor: accent.surface,
    color: accent.default,
    fontSize: font.caption,
    fontWeight: font.weightBold,
  },
  chevron: { flexShrink: 0, color: text.muted },
  breakdown: { paddingBottom: space.sm, paddingInline: space.xs },
  error: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.sm,
    paddingBlock: space.sm,
    fontSize: font.body,
    color: status.danger,
  },
  loadingRow: { paddingBlock: space.sm },
});

export type ChangedState =
  | { kind: "loading" }
  | { kind: "error"; onRetry: () => void }
  | { kind: "ready"; summary: StatusSummary };

function ReviewRow({
  badge,
  description,
  summary,
  hrefOf,
}: {
  badge: ReactNode;
  description: string;
  summary: StatusSummary;
  hrefOf: (type: HomeType) => string;
}) {
  const [only, ...rest] = summary.byType;
  // 裁定 B1: 型が 1 つなら行が一覧へのリンク、複数なら行はリンクにせず内訳リンクを添える
  const href = only !== undefined && rest.length === 0 ? hrefOf(only.type) : undefined;
  return (
    <div>
      <CardRow {...(href === undefined ? {} : { href })}>
        {badge}
        {/* 行の名前を語ごとに区切る(flex の子の空白は描かれない) */}{" "}
        <span {...stylex.props(styles.description)}>{description}</span>{" "}
        {/* 見た目は数字だけ。読み上げは「2 件」 */}
        <span aria-hidden="true" {...stylex.props(styles.count)}>
          {summary.total}
        </span>
        <VisuallyHidden>{HOME_LABELS.count(summary.total)}</VisuallyHidden>
        {href === undefined ? null : (
          <ChevronRight
            aria-hidden="true"
            size={ICON_SIZE.inline}
            {...stylex.props(styles.chevron)}
          />
        )}
      </CardRow>
      {href === undefined ? (
        <div {...stylex.props(styles.breakdown)}>
          <TypeLinks items={summary.byType} hrefOf={hrefOf} />
        </div>
      ) : null}
    </div>
  );
}

const statusHref = (slug: string, workflow: "in_review" | "ready") => (type: HomeType) =>
  listHref(slug, type.key, { status: workflow });

// b-home.md 2.3: 型をまたぐ確認待ちの集計。0 件の行は出さない
export function ReviewCard({
  slug,
  isLoading,
  inReview,
  ready,
  changed,
}: {
  slug: string;
  isLoading?: boolean;
  inReview: StatusSummary;
  ready: StatusSummary;
  changed: ChangedState;
}) {
  const changedTotal = changed.kind === "ready" ? changed.summary.total : 0;
  const isEmpty =
    inReview.total === 0 && ready.total === 0 && changed.kind === "ready" && changedTotal === 0;
  return (
    <HomeCard title={HOME_LABELS.review.title} note={HOME_LABELS.review.note}>
      {isLoading === true ? (
        <CardLoadingRows count={3} />
      ) : isEmpty ? (
        <CardEmpty icon={CircleCheck} text={HOME_LABELS.review.empty} />
      ) : (
        <>
          {inReview.total > 0 ? (
            <ReviewRow
              badge={<WorkflowStatusBadge status="in_review" />}
              description={HOME_LABELS.review.description.in_review}
              summary={inReview}
              hrefOf={statusHref(slug, "in_review")}
            />
          ) : null}
          {ready.total > 0 ? (
            <ReviewRow
              badge={<WorkflowStatusBadge status="ready" />}
              description={HOME_LABELS.review.description.ready}
              summary={ready}
              hrefOf={statusHref(slug, "ready")}
            />
          ) : null}
          {changed.kind === "loading" ? (
            <div aria-hidden="true" {...stylex.props(styles.loadingRow)}>
              <Skeleton height={24} width="100%" />
            </div>
          ) : null}
          {changed.kind === "error" ? (
            <div {...stylex.props(styles.error)}>
              <span role="alert">{HOME_LABELS.review.changedFailed}</span>
              <Button variant="link" size="sm" icon={RotateCw} onPress={changed.onRetry}>
                {HOME_LABELS.retry}
              </Button>
            </div>
          ) : null}
          {changed.kind === "ready" && changed.summary.total > 0 ? (
            <ReviewRow
              badge={<PublicationBadge state="changed" short={false} />}
              description={HOME_LABELS.review.description.changed}
              summary={changed.summary}
              hrefOf={(type) => listHref(slug, type.key, { tab: "unpublished-changes" })}
            />
          ) : null}
        </>
      )}
    </HomeCard>
  );
}
