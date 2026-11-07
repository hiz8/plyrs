import * as stylex from "@stylexjs/stylex";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { bg, border, font, radius, space, text } from "@plyrs/ui/semantic.stylex";
import { formatFieldDiff, type FieldChange } from "../../lib/history";
import { PROPOSAL_LABELS } from "../../lib/labels";
import type { ProposalKind } from "../../lib/proposals";

// 16.8(M5c): 提案の差分。フィールドごとに「現在」と「提案」を並べる(履歴の差分と同じ整形)

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.container,
    backgroundColor: bg.surface,
  },
  title: {
    margin: 0,
    fontFamily: font.family,
    fontSize: font.body,
    fontWeight: font.weightMedium,
    color: text.default,
  },
  muted: { margin: 0, fontSize: font.body, color: text.muted },
  table: { width: "100%", borderCollapse: "collapse", fontSize: font.body },
  th: {
    textAlign: "left",
    padding: space.xs,
    fontWeight: font.weightMedium,
    color: text.muted,
    fontSize: font.caption,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  td: {
    verticalAlign: "top",
    padding: space.xs,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
    overflowWrap: "anywhere",
  },
  key: { color: text.default, fontWeight: font.weightMedium, whiteSpace: "nowrap" },
});

export interface ProposalDiffProps {
  kind: ProposalKind;
  fields: readonly FieldChange[];
  definition: ContentTypeDefinition | undefined;
}

export function ProposalDiff({ kind, fields, definition }: ProposalDiffProps) {
  return (
    <section aria-label={PROPOSAL_LABELS.diffTitle} {...stylex.props(styles.panel)}>
      <h2 {...stylex.props(styles.title)}>{PROPOSAL_LABELS.diffTitle}</h2>
      {kind === "delete" || kind === "publish" || kind === "unpublish" ? (
        <p {...stylex.props(styles.muted)}>{PROPOSAL_LABELS.kindDescription[kind]}</p>
      ) : fields.length === 0 ? (
        <p {...stylex.props(styles.muted)}>{PROPOSAL_LABELS.noChanges}</p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th scope="col" {...stylex.props(styles.th)} />
              <th scope="col" {...stylex.props(styles.th)}>
                {PROPOSAL_LABELS.before}
              </th>
              <th scope="col" {...stylex.props(styles.th)}>
                {PROPOSAL_LABELS.after}
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((change) => {
              const diff = formatFieldDiff(change, definition);
              return (
                <tr key={diff.key}>
                  <th scope="row" {...stylex.props(styles.td, styles.key)}>
                    {diff.label}
                  </th>
                  <td {...stylex.props(styles.td)}>{diff.before}</td>
                  <td {...stylex.props(styles.td)}>{diff.after}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
