import * as stylex from "@stylexjs/stylex";
import {
  Avatar,
  Badge,
  Button,
  Cell,
  Column,
  Row,
  Skeleton,
  Table,
  TableBody,
  TableHeader,
} from "@plyrs/ui";
import { font, size, space, text } from "@plyrs/ui/semantic.stylex";
import type { MemberSummary } from "../../lib/admin-api";
import { formatDate } from "../../lib/datetime";
import { MEMBER_LABELS } from "../../lib/labels";
import type { MemberRow } from "../../lib/members";
import { isRole, type Role } from "../../lib/permissions";
import { RoleSelect } from "./role-select";

const styles = stylex.create({
  who: { display: "flex", alignItems: "center", gap: space.sm, minWidth: 0 },
  email: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { color: text.muted, fontSize: font.caption },
  skeleton: { display: "flex", flexDirection: "column", gap: space.sm },
});

export interface MembersTableProps {
  rows: readonly MemberRow[];
  onChangeRole: (member: MemberSummary, role: Role) => void;
  onRemove: (member: MemberSummary) => void;
  /** 変更中は行の操作を無効にする */
  isBusy?: boolean;
}

// メンバーの表(G7・G9・G11・G26)
export function MembersTable({ rows, onChangeRole, onRemove, isBusy = false }: MembersTableProps) {
  return (
    <Table aria-label={MEMBER_LABELS.tableLabel} selectionMode="none">
      <TableHeader>
        <Column id="email" isRowHeader>
          {MEMBER_LABELS.columns.email}
        </Column>
        <Column id="role">{MEMBER_LABELS.columns.role}</Column>
        <Column id="joined" hideOnNarrow>
          {MEMBER_LABELS.columns.joined}
        </Column>
        <Column id="actions">{MEMBER_LABELS.columns.actions}</Column>
      </TableHeader>
      <TableBody items={rows.map((row) => ({ ...row, id: row.member.userId }))}>
        {(row) => {
          const { member } = row;
          return (
            <Row id={row.id}>
              <Cell>
                <div {...stylex.props(styles.who)}>
                  <Avatar name={member.email} size="sm" />
                  <span {...stylex.props(styles.email)}>{member.email}</span>
                  {row.isSelf ? <Badge tone="accent">{MEMBER_LABELS.self}</Badge> : null}
                </div>
              </Cell>
              <Cell>
                {row.isLastOwner ? (
                  <Button
                    variant="link"
                    size="sm"
                    disabledReason={MEMBER_LABELS.lastOwnerReason}
                    // 無効理由を見せるだけのボタン。押しても何も起きない
                    onPress={() => {}}
                  >
                    {MEMBER_LABELS.lastOwner}
                  </Button>
                ) : (
                  <RoleSelect
                    label={`${member.email}のロール`}
                    value={isRole(member.role) ? member.role : "viewer"}
                    onChange={(role) => onChangeRole(member, role)}
                    isDisabled={isBusy}
                    size="sm"
                    isLabelHidden
                  />
                )}
              </Cell>
              <Cell hideOnNarrow>
                <span {...stylex.props(styles.muted)}>
                  {formatDate(new Date(member.createdAt))}
                </span>
              </Cell>
              <Cell>
                {row.isLastOwner ? null : (
                  <Button
                    variant="dangerLink"
                    size="sm"
                    aria-label={`${member.email}を外す`}
                    isDisabled={isBusy}
                    onPress={() => onRemove(member)}
                  >
                    {MEMBER_LABELS.remove}
                  </Button>
                )}
              </Cell>
            </Row>
          );
        }}
      </TableBody>
    </Table>
  );
}

// 読み込み中(読み上げない)
export function MembersTableSkeleton() {
  return (
    <div aria-hidden="true" {...stylex.props(styles.skeleton)}>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} height={size.row} width="100%" />
      ))}
    </div>
  );
}
