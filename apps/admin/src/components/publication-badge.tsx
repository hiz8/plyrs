import * as stylex from "@stylexjs/stylex";
import type { WorkflowStatus } from "@plyrs/metamodel";
import { Badge } from "@plyrs/ui";
import type { ListPublicationState } from "../lib/content-list";
import { LIST_LABELS, PUBLICATION_STATE_LABELS, WORKFLOW_STATUS_LABELS } from "../lib/labels";

const NARROW = "@media (max-width: 959px)";

// 長い文と短い文を CSS で切り替える(jsdom では両方描かれる)
const styles = stylex.create({
  long: { display: { default: "inline", [NARROW]: "none" } },
  short: { display: { default: "none", [NARROW]: "inline" } },
});

function ChangedText({ short }: { short: boolean | undefined }) {
  if (short === true) return <>{LIST_LABELS.changedShort}</>;
  if (short === false) return <>{LIST_LABELS.changedLong}</>;
  return (
    <>
      <span {...stylex.props(styles.long)}>{LIST_LABELS.changedLong}</span>
      {/* 読み上げが二重にならないよう短い方は隠す */}
      <span aria-hidden="true" {...stylex.props(styles.short)}>
        {LIST_LABELS.changedShort}
      </span>
    </>
  );
}

export function PublicationBadge({
  state,
  short,
}: {
  state: ListPublicationState;
  short?: boolean;
}) {
  if (state === "published") {
    return (
      <Badge tone="success" dot>
        {PUBLICATION_STATE_LABELS.published}
      </Badge>
    );
  }
  if (state === "changed") {
    return (
      <Badge tone="warning" dot>
        <ChangedText short={short} />
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" dot>
      {PUBLICATION_STATE_LABELS.unpublished}
    </Badge>
  );
}

export function WorkflowStatusBadge({ status }: { status: WorkflowStatus }) {
  const tone = status === "in_review" ? "accent" : status === "ready" ? "success" : "neutral";
  return (
    <Badge tone={tone} isStruck={status === "archived"}>
      {WORKFLOW_STATUS_LABELS[status]}
    </Badge>
  );
}
