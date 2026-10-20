import type { MemberSummary } from "./admin-api";
import { MEMBER_LABELS } from "./labels";
import { isRole, type Role } from "./permissions";

// メンバー管理の純関数(案 G 4 章、裁定 G11〜G13・G26・G30)
export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

// 両方が既知のロールで rank が下がるときだけ true。未知のロールは判断できないので false
export function isDowngrade(from: string, to: string): boolean {
  if (!isRole(from) || !isRole(to)) return false;
  return ROLE_RANK[to] < ROLE_RANK[from];
}

// owner がちょうど 1 人のとき、その userId(最後の管理者。ロール変更と削除を止める対象)
export function lastOwnerId(members: readonly MemberSummary[]): string | null {
  const owners = members.filter((member) => member.role === "owner");
  return owners.length === 1 ? (owners[0]?.userId ?? null) : null;
}

// 自分以外の owner のメール(API の順 = 参加日順のまま)
export function otherOwnerEmails(
  members: readonly MemberSummary[],
  selfId: string | undefined,
): string[] {
  return members
    .filter((member) => member.role === "owner" && member.userId !== selfId)
    .map((member) => member.email);
}

export interface MemberRow {
  member: MemberSummary;
  isSelf: boolean;
  isLastOwner: boolean;
}

// API の順(参加日の古い順)のまま、自分と最後の管理者の印を付ける
export function memberRows(
  members: readonly MemberSummary[],
  selfId: string | undefined,
): MemberRow[] {
  const lastOwner = lastOwnerId(members);
  return members.map((member) => ({
    member,
    isSelf: selfId !== undefined && member.userId === selfId,
    isLastOwner: lastOwner !== null && member.userId === lastOwner,
  }));
}

// 降格の確認ダイアログの本文(owner への変更は降格ではないので空)
export function demoteBody(to: Role): string {
  if (to === "viewer") return MEMBER_LABELS.demote.toViewer;
  if (to === "editor") return MEMBER_LABELS.demote.toEditor;
  return "";
}
