import type { TokenSummary } from "./admin-api";
import { formatDateTime } from "./datetime";
import { TOKEN_LABELS } from "./labels";
import { can, type Operation, type Role } from "./permissions";

// M1-4(design-spec 16.3、論点 C5): 接続トークン(PAT)画面の純関数。
// スコープの選択肢と期限の規則は api の auth/pat.ts と同じ(一致はそれぞれのテストで固定する):
// - 発行できるスコープはロールの範囲内。record:publish は管理者だけが付けられ、既定で外す
// - 読み取りだけのトークンは最長 365 日(既定 90)、書き込みを含むと最長 90 日(既定 30)

export const PAT_SCOPES = [
  "record:read",
  "record:write",
  "record:delete",
  "record:publish",
  "type:manage",
] as const satisfies readonly Operation[];

export type PatScope = (typeof PAT_SCOPES)[number];

export const DEFAULT_SCOPES: readonly PatScope[] = ["record:read"];

const READ_ONLY_EXPIRY_DAYS = [30, 90, 365] as const;
const WRITE_EXPIRY_DAYS = [7, 30, 90] as const;
const DEFAULT_READ_ONLY_DAYS = 90;
const DEFAULT_WRITE_DAYS = 30;
const DAY = 86_400_000;

export interface ScopeOption {
  value: PatScope;
  label: string;
  description: string;
}

export function scopeOptionsFor(role: Role): ScopeOption[] {
  return PAT_SCOPES.filter(
    // 論点 C5: 編集者は自分では公開できても、トークンに record:publish を付けられるのは管理者だけ
    (scope) => can(role, scope) && (scope !== "record:publish" || role === "owner"),
  ).map((scope) => ({
    value: scope,
    label: TOKEN_LABELS.scopes[scope],
    description: TOKEN_LABELS.scopeDescriptions[scope],
  }));
}

export function isReadOnlyScopes(scopes: readonly string[]): boolean {
  return scopes.every((scope) => scope === "record:read");
}

export function expiryOptionsFor(scopes: readonly string[]): { days: number; label: string }[] {
  const days = isReadOnlyScopes(scopes) ? READ_ONLY_EXPIRY_DAYS : WRITE_EXPIRY_DAYS;
  return days.map((value) => ({ days: value, label: TOKEN_LABELS.expiryOption(value) }));
}

export function defaultExpiryFor(scopes: readonly string[]): number {
  return isReadOnlyScopes(scopes) ? DEFAULT_READ_ONLY_DAYS : DEFAULT_WRITE_DAYS;
}

export type TokenStatus = "active" | "expired" | "revoked";

export interface TokenRow {
  token: TokenSummary;
  status: TokenStatus;
  expiryText: string;
  lastUsedText: string;
  canRevoke: boolean;
}

// API の順(発行の新しい順)のまま、状態と表示用の文字を付ける
export function tokenRows(tokens: readonly TokenSummary[], now: Date): TokenRow[] {
  return tokens.map((token) => {
    const expiresAt = new Date(token.expiresAt).getTime();
    let status: TokenStatus = "active";
    if (token.revokedAt !== null) {
      status = "revoked";
    } else if (expiresAt <= now.getTime()) {
      status = "expired";
    }
    const remainingDays = Math.max(0, Math.ceil((expiresAt - now.getTime()) / DAY));
    return {
      token,
      status,
      expiryText:
        status === "active" ? TOKEN_LABELS.expiresIn(remainingDays) : TOKEN_LABELS.status[status],
      lastUsedText:
        token.lastUsedAt === null
          ? TOKEN_LABELS.neverUsed
          : formatDateTime(token.lastUsedAt, { now }).text,
      canRevoke: status === "active",
    };
  });
}

// 発行・一覧・失効は管理者だけ(API 側も member:manage で 403)
export function canManageTokens(role: string): boolean {
  return can(role, "member:manage");
}

export function mcpEndpoint(apiOrigin: string, tenantId: string): string {
  return `${apiOrigin.replace(/\/+$/, "")}/mcp/t/${tenantId}`;
}
