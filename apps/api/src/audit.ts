import { drizzle } from "drizzle-orm/d1";
import { v7 as uuidv7 } from "uuid";
import { auditLogs } from "@plyrs/db/control-plane";

// design-spec §11.6: super 権限の行使は必ず記録する(案 G 3・4 章: テナントの owner による
// サイト名の変更・メンバーの管理も同じ表に記録する。actorId はその利用者の userId)。操作成功後に await で書く
// (best-effort にしない — 記録の失敗は 500 として表面化させる)。
export type AuditAction =
  | "super.bootstrap"
  | "super.login"
  | "tenant.create"
  | "tenant.rename"
  | "tenant.delete"
  | "user.ban"
  | "user.unban"
  | "membership.revoke"
  | "reproject.start"
  | "tenant.search_reindex"
  | "module.redistribute"
  | "dlq.replay"
  | "dlq.discard"
  | "orphan_assets.delete"
  | "site.rename"
  | "member.add"
  | "member.role_change"
  | "member.remove"
  // M1-3a(design-spec 16.3): PAT の発行・失効。targetId は PAT の行 ID
  | "token.issue"
  | "token.revoke";

// メンバーシップを対象にした操作の targetId(運営者の剥奪と owner のメンバー管理で同じ形式にそろえ、
// 同じ対象の履歴を 1 つの値で検索できるようにする)
export function membershipAuditTarget(userId: string, tenantId: string): string {
  return `${userId}:${tenantId}`;
}

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  detail?: unknown;
}

function auditRow(entry: AuditEntry, createdAt: string) {
  return {
    id: uuidv7(),
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    detail: JSON.stringify(entry.detail ?? {}),
    createdAt,
  };
}

export async function writeAudit(d1: D1Database, entry: AuditEntry): Promise<void> {
  await drizzle(d1).insert(auditLogs).values(auditRow(entry, new Date().toISOString()));
}

// 複数行を 1 回の INSERT で書く(BAN のように件数が利用者の加入数に比例する後始末のため)
export async function writeAudits(d1: D1Database, entries: readonly AuditEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const createdAt = new Date().toISOString();
  await drizzle(d1)
    .insert(auditLogs)
    .values(entries.map((entry) => auditRow(entry, createdAt)));
}

// 会員資格の喪失(会員を外す・運営者の剥奪・BAN)に伴って失効させた PAT を 1 件ずつ記録する。
// token.revoke の対象は PAT の id で、手動の失効と同じ値で履歴を引ける。reason に元の操作を残す
export async function auditRevokedTokens(
  d1: D1Database,
  actorId: string,
  tenantId: string | null,
  tokenIds: readonly string[],
  reason: AuditAction,
): Promise<void> {
  await writeAudits(
    d1,
    tokenIds.map((tokenId) => ({
      actorId,
      action: "token.revoke" as const,
      targetType: "pat",
      targetId: tokenId,
      detail: tenantId === null ? { reason } : { tenantId, reason },
    })),
  );
}
