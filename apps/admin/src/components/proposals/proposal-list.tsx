import * as stylex from "@stylexjs/stylex";
import { Link, type LinkRenderProps } from "react-aria-components";
import { Badge, RelativeTime, stylexRenderProps, type BadgeTone } from "@plyrs/ui";
import { bg, border, focus, font, radius, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import { formatDateTime } from "../../lib/datetime";
import type { MemberName } from "../../lib/history";
import { PROPOSAL_LABELS } from "../../lib/labels";
import { kindLabel, stateLabel, summarizeProposal } from "../../lib/proposals";
import { type ProposalKind, type ProposalSummary } from "../../lib/api-contracts";

// 16.8(M5c): 提案の一覧の行。行全体が詳細へのリンク

const styles = stylex.create({
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
  },
  item: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: space.xs,
    padding: space.sm,
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    textDecoration: "none",
    backgroundColor: bg.surface,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
    outline: "none",
    cursor: "pointer",
  },
  hovered: { backgroundColor: bg.hover },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: `calc(-1 * ${stroke.focus})`,
  },
  row: { display: "flex", alignItems: "center", gap: space.xs, flexWrap: "wrap" },
  title: { fontWeight: font.weightMedium, overflowWrap: "anywhere" },
  summary: { margin: 0 },
  time: { fontSize: font.caption, color: text.muted },
  empty: { margin: 0, fontSize: font.body, color: text.muted },
});

export function kindTone(kind: ProposalKind): BadgeTone {
  switch (kind) {
    case "publish":
      return "success";
    case "unpublish":
    case "delete":
      return "warning";
    case "create":
      return "accent";
    case "update":
      return "neutral";
  }
}

export interface ProposalListProps {
  items: readonly ProposalSummary[];
  hrefOf: (proposal: ProposalSummary) => string;
  titleOf: (proposal: ProposalSummary) => string;
  members?: readonly MemberName[];
  emptyMessage: string;
}

export function ProposalList({
  items,
  hrefOf,
  titleOf,
  members = [],
  emptyMessage,
}: ProposalListProps) {
  if (items.length === 0) {
    return <p {...stylex.props(styles.empty)}>{emptyMessage}</p>;
  }
  return (
    <ul aria-label={PROPOSAL_LABELS.listLabel} {...stylex.props(styles.list)}>
      {items.map((proposal) => (
        <li key={proposal.id}>
          <Link
            href={hrefOf(proposal)}
            className={stylexRenderProps<LinkRenderProps>((state) => [
              styles.item,
              state.isHovered && styles.hovered,
              state.isFocusVisible && styles.focusVisible,
            ])}
          >
            <span {...stylex.props(styles.row)}>
              <Badge tone={kindTone(proposal.kind)}>{kindLabel(proposal.kind)}</Badge>
              {proposal.state !== "open" && <Badge>{stateLabel(proposal.state)}</Badge>}
              {proposal.stale && proposal.state === "open" && (
                <Badge tone="warning">{PROPOSAL_LABELS.stale}</Badge>
              )}
              <span {...stylex.props(styles.title)}>{titleOf(proposal)}</span>
            </span>
            <span {...stylex.props(styles.summary)}>{summarizeProposal(proposal, members)}</span>
            <span {...stylex.props(styles.time)}>
              <RelativeTime value={formatDateTime(proposal.createdAt)} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
