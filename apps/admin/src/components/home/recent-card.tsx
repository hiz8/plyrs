import * as stylex from "@stylexjs/stylex";
import { Inbox } from "lucide-react";
import { RelativeTime } from "@plyrs/ui";
import { font, text } from "@plyrs/ui/semantic.stylex";
import { formatDateTime } from "../../lib/datetime";
import { recordHref, type HomeRecord } from "../../lib/home";
import { HOME_LABELS } from "../../lib/labels";
import { WorkflowStatusBadge } from "../publication-badge";
import { CardEmpty, CardLoadingRows, CardRow, HomeCard, RowTitleLink } from "./home-card";

const NARROW = "@media (max-width: 959px)";

// b-home.md 2.4: 型名 80px・ステータス 96px(中央)・相対時刻 110px(右寄せ)
const styles = stylex.create({
  typeName: {
    flexShrink: 0,
    width: "80px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: font.caption,
    color: text.muted,
    // H 10 章: 狭い幅では優先度の低い列を隠す
    display: { default: "block", [NARROW]: "none" },
  },
  status: {
    flexShrink: 0,
    width: "96px",
    justifyContent: "center",
    display: { default: "flex", [NARROW]: "none" },
  },
  time: { flexShrink: 0, width: "110px", textAlign: "right" },
});

export function RecentCard({
  slug,
  isLoading,
  rows,
}: {
  slug: string;
  isLoading?: boolean;
  rows: readonly HomeRecord[];
}) {
  return (
    <HomeCard title={HOME_LABELS.recent.title} note={HOME_LABELS.recent.note}>
      {isLoading === true ? (
        <CardLoadingRows count={5} />
      ) : rows.length === 0 ? (
        <CardEmpty icon={Inbox} text={HOME_LABELS.recent.empty} />
      ) : (
        rows.map((row) => (
          <CardRow key={row.record.id}>
            <RowTitleLink href={recordHref(slug, row.type.key, row.record.id)}>
              {row.title}
            </RowTitleLink>
            <span {...stylex.props(styles.typeName)}>{row.type.name}</span>
            <span {...stylex.props(styles.status)}>
              <WorkflowStatusBadge status={row.record.status} />
            </span>
            <span {...stylex.props(styles.time)}>
              <RelativeTime value={formatDateTime(row.record.updatedAt)} />
            </span>
          </CardRow>
        ))
      )}
    </HomeCard>
  );
}
