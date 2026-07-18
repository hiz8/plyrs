import type { AuthContext } from "../do/authorize";

// design-spec §11.6: super は第2段認可を「飛び越える」。実装形は Worker(信頼境界)が
// owner 相当の合成 AuthContext を DO RPC へ渡すこと。この関数の呼び出し元は必ず
// writeAudit で行使を記録する(強い権限には記録を伴わせる)。
export function superAuthContext(adminId: string, tenantId: string): AuthContext {
  return { userId: `super:${adminId}`, role: "owner", tenantId };
}
