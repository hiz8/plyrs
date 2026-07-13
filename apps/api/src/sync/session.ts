import type { Role } from "../auth/permissions";
import { TOKEN_PROTOCOL_PREFIX } from "@plyrs/sync-protocol";

// Worker（信頼境界）が検証した claims を DO に渡す内部ヘッダ。
// DO は Worker binding 経由でしか到達できないため、この値は偽造されない。
export const AUTH_HEADER = "x-plyrs-auth";

export interface SocketAuth {
  userId: string;
  role: Role;
  tenantId: string;
  exp: number; // JWT の exp（秒）。ハイバネーション越しに attachment で持ち回る
}

export function extractTokenProtocol(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  for (const raw of header.split(",")) {
    const value = raw.trim();
    if (value.startsWith(TOKEN_PROTOCOL_PREFIX)) {
      const token = value.slice(TOKEN_PROTOCOL_PREFIX.length);
      return token.length > 0 ? token : null;
    }
  }
  return null;
}

export function readSocketAuth(ws: WebSocket): SocketAuth | null {
  const attachment = ws.deserializeAttachment();
  return attachment === null ? null : (attachment as SocketAuth);
}

export function isTokenExpired(auth: SocketAuth, nowMs: number): boolean {
  // exp が壊れている attachment は失効扱い（NaN 比較で恒偽になり「永久に失効しない」を防ぐ）
  if (!Number.isFinite(auth.exp)) {
    return true;
  }
  return auth.exp * 1000 <= nowMs;
}
