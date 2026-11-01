import { can, type Operation, type Role } from "../auth/permissions";

export interface AuthContext {
  userId: string;
  role: Role;
  // テナント境界を跨いで運ばれる場合のみ存在(HTTP ゲート / WS ソケット auth 由来)。
  // Phase 9: module_events の送出先(do_config.tenant_id)を write 経路でも刻むために使う。
  tenantId?: string;
}

// design-spec 16.3(決定 49): MCP の認可コンテキスト。既存の {userId, role, tenantId, exp} に
// スコープ(権限を絞るだけで増やさない)・トークンの行 ID・トークンの種別を足す。
// tokenKind はトークンの入手経路(PAT / OAuth)で、書き込み経路の via(16.4)とは別の概念(用語集)。
export interface McpAuth extends AuthContext {
  tenantId: string;
  exp: number; // 失効時刻(秒)
  scopes: Operation[];
  tokenId: string;
  tokenKind: "pat" | "oauth";
}

// design-spec §11.5 第2段（型×操作）。Phase 2 引き継ぎ事項により beforeWrite パイプライン
// ではなく RPC 入口（no-op 判定・検証より前）で判定する — no-op 経路が
// 「現在値を正確に当てた書き込み」の内容確認オラクルになるのを防ぐ。
//
// 読み取り（getRecord / getContentType）は Phase 3 時点では非ガード:
// 全デフォルトロールが record:read を持ち判定が空虚なため。Worker ゲートが
// メンバーのみを到達させる。モジュール権限で read 制限が入る Phase 9 で再訪。
// M1-1(16.3): MCP の invoke 経路(ops/invoke.ts)は record:read も判定する(読み取り拒否はそこが最初)。
// 同期・管理画面の経路の非ガードは変えない。
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
