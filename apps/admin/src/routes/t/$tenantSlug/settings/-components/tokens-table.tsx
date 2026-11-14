import * as stylex from "@stylexjs/stylex";
import { Badge, Button, Cell, Column, Row, Table, TableBody, TableHeader } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { TOKEN_LABELS } from "../-lib/settings-labels";
import type { ConnectionRow } from "../-lib/tokens";

const styles = stylex.create({
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  scopes: { display: "flex", flexWrap: "wrap", gap: space.xs },
  muted: { color: text.muted, fontSize: font.caption },
  block: { display: "block" },
});

function scopeLabel(scope: string): string {
  return scope in TOKEN_LABELS.scopes
    ? TOKEN_LABELS.scopes[scope as keyof typeof TOKEN_LABELS.scopes]
    : scope;
}

// 接続中のアプリの表(M1-4、M3-5)。PAT と OAuth の付与を同じ列で並べ、失効済み・期限切れの行は残して
// 状態だけ見せる。OAuth の行は名前の下に利用者のメールを出す(所有者がテナント全員分を見るため)
export function TokensTable({
  rows,
  onRevoke,
  isBusy = false,
}: {
  rows: readonly ConnectionRow[];
  onRevoke: (row: ConnectionRow) => void;
  /** 変更中は行の操作を無効にする */
  isBusy?: boolean;
}) {
  return (
    <Table aria-label={TOKEN_LABELS.tableLabel} selectionMode="none">
      <TableHeader>
        <Column id="kind">{TOKEN_LABELS.columns.kind}</Column>
        <Column id="name" isRowHeader>
          {TOKEN_LABELS.columns.name}
        </Column>
        <Column id="scopes">{TOKEN_LABELS.columns.scopes}</Column>
        <Column id="expires">{TOKEN_LABELS.columns.expires}</Column>
        <Column id="lastUsed" hideOnNarrow>
          {TOKEN_LABELS.columns.lastUsed}
        </Column>
        <Column id="actions">{TOKEN_LABELS.columns.actions}</Column>
      </TableHeader>
      <TableBody items={rows}>
        {(row) => (
          <Row id={row.id}>
            <Cell>
              <Badge tone={row.kind === "oauth" ? "accent" : "neutral"}>
                {TOKEN_LABELS.kinds[row.kind]}
              </Badge>
            </Cell>
            <Cell>
              <span {...stylex.props(styles.name)}>{row.name}</span>
              {row.email === null ? null : (
                <span {...stylex.props(styles.muted, styles.block)}>{row.email}</span>
              )}
            </Cell>
            <Cell>
              <div {...stylex.props(styles.scopes)}>
                {row.scopes.map((scope) => (
                  <Badge key={scope}>{scopeLabel(scope)}</Badge>
                ))}
              </div>
            </Cell>
            <Cell>
              {row.status === "active" ? (
                <span {...stylex.props(styles.muted)}>{row.expiryText}</span>
              ) : (
                <Badge tone="warning">{TOKEN_LABELS.status[row.status]}</Badge>
              )}
            </Cell>
            <Cell hideOnNarrow>
              <span {...stylex.props(styles.muted)}>{row.lastUsedText}</span>
            </Cell>
            <Cell>
              {row.canRevoke ? (
                <Button
                  variant="dangerLink"
                  size="sm"
                  aria-label={TOKEN_LABELS.revokeOf(row.name)}
                  isDisabled={isBusy}
                  onPress={() => onRevoke(row)}
                >
                  {TOKEN_LABELS.revoke}
                </Button>
              ) : null}
            </Cell>
          </Row>
        )}
      </TableBody>
    </Table>
  );
}
