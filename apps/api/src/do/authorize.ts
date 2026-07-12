import { can, type Operation, type Role } from "../auth/permissions";

export interface AuthContext {
  userId: string;
  role: Role;
}

// design-spec §11.5 第2段（型×操作）。Phase 2 申し送りにより beforeWrite パイプライン
// ではなく RPC 入口（no-op 判定・検証より前）で判定する — no-op 経路が
// 「現在値を正確に当てた書き込み」の内容確認オラクルになるのを防ぐ。
//
// 読み取り（getRecord / getContentType）は Phase 3 時点では非ガード:
// 全デフォルトロールが record:read を持ち判定が空虚なため。Worker ゲートが
// メンバーのみを到達させる。モジュール権限で read 制限が入る Phase 9 で再訪。
export function requireOperation(
  auth: AuthContext,
  operation: Operation,
): { ok: false; code: "forbidden"; message: string } | null {
  if (can(auth.role, operation)) {
    return null;
  }
  return {
    ok: false,
    code: "forbidden",
    message: `role '${auth.role}' cannot perform ${operation}`,
  };
}
