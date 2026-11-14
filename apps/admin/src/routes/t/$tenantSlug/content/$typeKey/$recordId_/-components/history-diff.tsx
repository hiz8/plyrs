import * as stylex from "@stylexjs/stylex";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { Banner, Button, Skeleton } from "@plyrs/ui";
import { bg, border, font, radius, space, text } from "@plyrs/ui/semantic.stylex";
import { formatFieldDiff } from "~/lib/history";
import type { CompareResult } from "~/lib/api-contracts";
import { HISTORY_LABELS } from "~/lib/labels";

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.container,
    backgroundColor: bg.surface,
  },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.sm },
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
  loading: { display: "flex", flexDirection: "column", gap: space.sm },
});

export interface HistoryDiffProps {
  compare: CompareResult | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  definition: ContentTypeDefinition | undefined;
  /** record:write が無い(viewer)か、公開版の疑似行を選んでいるときは出さない */
  canRestore: boolean;
  onRestore: () => void;
  hasSelection: boolean;
}

// 選んだ版と現在の差分(右列)。フィールドごとに「この版」と「現在」を並べる
export function HistoryDiff({
  compare,
  isLoading,
  isError,
  onRetry,
  definition,
  canRestore,
  onRestore,
  hasSelection,
}: HistoryDiffProps) {
  return (
    <section aria-label={HISTORY_LABELS.compareTitle} {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.head)}>
        <h2 {...stylex.props(styles.title)}>{HISTORY_LABELS.compareTitle}</h2>
        {canRestore && compare !== undefined && (
          <Button variant="secondary" size="sm" onPress={onRestore}>
            {HISTORY_LABELS.restore}
          </Button>
        )}
      </div>
      {!hasSelection ? (
        <p {...stylex.props(styles.muted)}>{HISTORY_LABELS.noSelection}</p>
      ) : isError ? (
        <Banner tone="danger">
          {HISTORY_LABELS.compareFailed}{" "}
          <Button variant="link" size="sm" onPress={onRetry}>
            {HISTORY_LABELS.retry}
          </Button>
        </Banner>
      ) : isLoading || compare === undefined ? (
        <div aria-hidden="true" {...stylex.props(styles.loading)}>
          <Skeleton height={14} width="100%" />
          <Skeleton height={14} width="70%" />
        </div>
      ) : compare.fields.length === 0 ? (
        <p {...stylex.props(styles.muted)}>{HISTORY_LABELS.noChanges}</p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th scope="col" {...stylex.props(styles.th)} />
              <th scope="col" {...stylex.props(styles.th)}>
                {HISTORY_LABELS.before}
              </th>
              <th scope="col" {...stylex.props(styles.th)}>
                {HISTORY_LABELS.after}
              </th>
            </tr>
          </thead>
          <tbody>
            {compare.fields.map((change) => {
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
