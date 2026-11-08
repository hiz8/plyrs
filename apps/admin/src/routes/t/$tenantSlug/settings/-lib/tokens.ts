import type { GrantSummary, TokenSummary } from "~/lib/admin-api";
import { formatDateTime } from "~/lib/datetime";
import { TOKEN_LABELS } from "./settings-labels";
import { can, type Operation } from "~/lib/permissions";
import type { Role } from "~/lib/api-contracts";

// M1-4(design-spec 16.3、論点 C5): 接続トークン(PAT)画面の純関数。
// スコープの選択肢と期限の規則は api の auth/pat.ts と同じ(一致はそれぞれのテストで固定する):
// - 発行できるスコープはロールの範囲内。record:publish は管理者だけが付けられ、既定で外す
// - 読み取りだけのトークンは最長 365 日(既定 90)、書き込みを含むと最長 90 日(既定 30)

export const PAT_SCOPES = [
  "record:read",
  "record:propose",
  "record:write",
  "record:delete",
  "record:publish",
  "type:manage",
] as const satisfies readonly Operation[];

export type PatScope = (typeof PAT_SCOPES)[number];

// M5c の申し送り(2026-11-08、所有者の判断): record:write は record:propose を内包しない(スコープは
// 互いに独立のまま)。その代わり、新しく発行するトークンには既定で提案を持たせる。提案は書き込みの
// 一種なので、期限は書き込みの規則(isReadOnlyScopes は record:read だけを読み取り専用とみなす)
export const DEFAULT_SCOPES: readonly PatScope[] = ["record:read", "record:propose"];

// record:write を付けて record:propose を外したときの注意(conflict が続くときや確認できない公開で
// 提案に回れない)
export function lacksProposeFallback(scopes: readonly string[]): boolean {
  return scopes.includes("record:write") && !scopes.includes("record:propose");
}

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

// M3-5(design-spec 16.3): 「接続中のアプリ」の 1 行。PAT と OAuth の付与を同じ表に並べる。
// OAuth の行の名前はクライアント名(CIMD の metadata または DCR の client_name)、無ければ client_id。
// 最終利用は OAuth では記録していないので「—」。付与は失効済み・期限切れだと KV から消えるので常に失効できる
export type ConnectionRow = {
  id: string;
  name: string;
  scopes: readonly string[];
  // 利用者のメール(OAuth の付与は会員ごと。PAT は発行者自身なので出さない)
  email: string | null;
  status: TokenStatus;
  expiryText: string;
  lastUsedText: string;
  canRevoke: boolean;
} & ({ kind: "pat"; token: TokenSummary } | { kind: "oauth"; grant: GrantSummary });

function grantRow(grant: GrantSummary, now: Date): ConnectionRow {
  let expiryText: string = TOKEN_LABELS.noExpiry;
  let status: TokenStatus = "active";
  if (grant.pending) {
    expiryText = TOKEN_LABELS.pending;
  } else if (grant.expiresAt !== null) {
    const remaining = new Date(grant.expiresAt).getTime() - now.getTime();
    if (remaining <= 0) {
      status = "expired";
      expiryText = TOKEN_LABELS.status.expired;
    } else {
      expiryText = TOKEN_LABELS.expiresIn(Math.max(0, Math.ceil(remaining / DAY)));
    }
  }
  return {
    kind: "oauth",
    grant,
    id: `oauth:${grant.id}`,
    name: grant.clientName ?? grant.clientId,
    scopes: grant.scopes,
    email: grant.email,
    status,
    expiryText,
    lastUsedText: TOKEN_LABELS.notApplicable,
    canRevoke: true,
  };
}

// PAT を発行順(API の順)に、続けて OAuth の付与を createdAt 順に並べる
export function connectionRows(
  tokens: readonly TokenSummary[],
  grants: readonly GrantSummary[],
  now: Date,
): ConnectionRow[] {
  const pats: ConnectionRow[] = tokenRows(tokens, now).map((row) => ({
    kind: "pat",
    token: row.token,
    id: `pat:${row.token.id}`,
    name: row.token.name,
    scopes: row.token.scopes,
    email: null,
    status: row.status,
    expiryText: row.expiryText,
    lastUsedText: row.lastUsedText,
    canRevoke: row.canRevoke,
  }));
  const oauth = grants
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((grant) => grantRow(grant, now));
  return [...pats, ...oauth];
}

// 発行・一覧・失効は管理者だけ(API 側も member:manage で 403)
export function canManageTokens(role: string): boolean {
  return can(role, "member:manage");
}

export function mcpEndpoint(apiOrigin: string, tenantId: string): string {
  return `${apiOrigin.replace(/\/+$/, "")}/mcp/t/${tenantId}`;
}
