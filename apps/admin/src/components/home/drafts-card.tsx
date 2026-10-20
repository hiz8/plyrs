import * as stylex from "@stylexjs/stylex";
import { Pencil, RotateCw } from "lucide-react";
import { Button, RelativeTime } from "@plyrs/ui";
import { font, space, status, text } from "@plyrs/ui/semantic.stylex";
import { formatDateTime } from "../../lib/datetime";
import { listHref, recordHref, type HomeRecord, type StatusSummary } from "../../lib/home";
import { HOME_LABELS } from "../../lib/labels";
import {
  CardEmpty,
  CardFooter,
  CardLoadingRows,
  CardRow,
  HomeCard,
  RowTitleLink,
  SummaryLink,
} from "./home-card";

const styles = stylex.create({
  typeName: { flexShrink: 0, fontSize: font.caption, color: text.muted },
  time: { flexShrink: 0 },
  error: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.sm,
    paddingBlock: space.sm,
    fontSize: font.body,
    color: status.danger,
  },
});

export type DraftsState =
  | { kind: "loading" }
  | { kind: "error"; message: string; onRetry: () => void }
  | { kind: "ready"; drafts: HomeRecord[]; summary: StatusSummary };

// b-home.md 2.2: 自分が最後に編集した下書き。全件は一覧へ(裁定 B11)
export function DraftsCard({ slug, state }: { slug: string; state: DraftsState }) {
  return (
    <HomeCard title={HOME_LABELS.drafts.title} note={HOME_LABELS.drafts.note}>
      {state.kind === "loading" ? <CardLoadingRows count={3} /> : null}
      {state.kind === "error" ? (
        <div {...stylex.props(styles.error)}>
          <span role="alert">{state.message}</span>
          <Button variant="link" size="sm" icon={RotateCw} onPress={state.onRetry}>
            {HOME_LABELS.retry}
          </Button>
        </div>
      ) : null}
      {state.kind === "ready" ? (
        <>
          {state.drafts.length === 0 ? (
            <CardEmpty
              icon={Pencil}
              text={HOME_LABELS.drafts.empty}
              hint={HOME_LABELS.drafts.emptyHint}
            />
          ) : (
            state.drafts.map((draft) => (
              <CardRow key={draft.record.id}>
                <RowTitleLink href={recordHref(slug, draft.type.key, draft.record.id)}>
                  {draft.title}
                </RowTitleLink>
                <span {...stylex.props(styles.typeName)}>{draft.type.name}</span>
                <span {...stylex.props(styles.time)}>
                  <RelativeTime value={formatDateTime(draft.record.updatedAt)} />
                </span>
              </CardRow>
            ))
          )}
          {state.summary.total > 0 ? (
            <CardFooter>
              <SummaryLink
                summary={state.summary}
                label={HOME_LABELS.drafts.seeAll}
                hrefOf={(type) => listHref(slug, type.key, { status: "draft" })}
              />
            </CardFooter>
          ) : null}
        </>
      ) : null}
    </HomeCard>
  );
}
