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
