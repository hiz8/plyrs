import * as stylex from "@stylexjs/stylex";
import { Badge, Button, Cell, Column, Row, Table, TableBody, TableHeader } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import type { TokenSummary } from "../../lib/admin-api";
import { TOKEN_LABELS } from "../../lib/labels";
import type { TokenRow } from "../../lib/tokens";

const styles = stylex.create({
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  scopes: { display: "flex", flexWrap: "wrap", gap: space.xs },
  muted: { color: text.muted, fontSize: font.caption },
});

function scopeLabel(scope: string): string {
  return scope in TOKEN_LABELS.scopes
    ? TOKEN_LABELS.scopes[scope as keyof typeof TOKEN_LABELS.scopes]
    : scope;
}

// 接続トークンの表(M1-4)。失効済み・期限切れの行は残して状態だけ見せる
export function TokensTable({
  rows,
  onRevoke,
  isBusy = false,
}: {
  rows: readonly TokenRow[];
  onRevoke: (token: TokenSummary) => void;
  /** 変更中は行の操作を無効にする */
  isBusy?: boolean;
}) {
  return (
    <Table aria-label={TOKEN_LABELS.tableLabel} selectionMode="none">
      <TableHeader>
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
      <TableBody items={rows.map((row) => ({ ...row, id: row.token.id }))}>
        {(row) => (
          <Row id={row.id}>
            <Cell>
              <span {...stylex.props(styles.name)}>{row.token.name}</span>
            </Cell>
            <Cell>
              <div {...stylex.props(styles.scopes)}>
                {row.token.scopes.map((scope) => (
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
                  aria-label={TOKEN_LABELS.revokeOf(row.token.name)}
                  isDisabled={isBusy}
                  onPress={() => onRevoke(row.token)}
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
