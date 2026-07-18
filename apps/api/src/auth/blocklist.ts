// design-spec §11.2: 権限剥奪・BAN の即時失効はブロックリスト照会で効かせる。
// 更新は失効イベント時のみ（稀）、読みは毎リクエスト（KV はエッジで安価）。
function keyFor(userId: string): string {
  return `blocked:user:${userId}`;
}

export async function isBlocked(kv: KVNamespace, userId: string): Promise<boolean> {
  return (await kv.get(keyFor(userId))) !== null;
}

export async function blockUser(kv: KVNamespace, userId: string): Promise<void> {
  await kv.put(keyFor(userId), "1");
}

export async function unblockUser(kv: KVNamespace, userId: string): Promise<void> {
  await kv.delete(keyFor(userId));
}

// §6 裁定(2026-07-18): (userId, tenantId) 粒度の二層目。TTL は JWT 15 分 + マージン —
// 失効後は D1 の membership 不在(/auth/token の再読込)が引き継ぐため自己清掃で足りる。
const MEMBERSHIP_BLOCK_TTL_SECONDS = 1200;

function membershipKey(userId: string, tenantId: string): string {
  return `blocked:membership:${userId}:${tenantId}`;
}

export async function isMembershipBlocked(
  kv: KVNamespace,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  return (await kv.get(membershipKey(userId, tenantId))) !== null;
}

export async function blockMembership(
  kv: KVNamespace,
  userId: string,
  tenantId: string,
): Promise<void> {
  await kv.put(membershipKey(userId, tenantId), "1", {
    expirationTtl: MEMBERSHIP_BLOCK_TTL_SECONDS,
  });
}

export async function unblockMembership(
  kv: KVNamespace,
  userId: string,
  tenantId: string,
): Promise<void> {
  await kv.delete(membershipKey(userId, tenantId));
}
