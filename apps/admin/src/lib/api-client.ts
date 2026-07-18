// 管理画面 → api Worker の HTTP 契約（すべて same-origin 相対パス。2026-07-16 裁定 #1）。
// fetch は注入可能（テストはスタブを渡す）。セッション cookie は same-origin fetch の既定で送られる。
export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  role: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail === undefined ? `${status}: ${code}` : `${status}: ${code} (${detail})`);
    this.name = "ApiError";
  }
}

export async function throwApiError(response: Response): Promise<never> {
  let code = "unknown_error";
  let detail: string | undefined;
  try {
    const body = (await response.json()) as { error?: unknown; code?: unknown; message?: unknown };
    // /auth 系は { error }、DO 由来の結果は { ok: false, code, message } — 両対応で拾う
    if (typeof body.error === "string") {
      code = body.error;
    } else if (typeof body.code === "string") {
      code = body.code;
    }
    if (typeof body.message === "string") {
      detail = body.message;
    }
  } catch {
    // 本文が JSON でない（ゲートウェイ応答等）場合は unknown_error のまま
  }
  throw new ApiError(response.status, code, detail);
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

// 既定値はグローバル fetch を束縛したラッパー。素の `fetch` を既定値にすると、ブラウザで
// detached call（this 喪失）となり Illegal invocation を投げる。
export function createApiClient(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(path, init);
    if (!response.ok) {
      return throwApiError(response);
    }
    return (await response.json()) as T;
  }
  return {
    signup(email: string, password: string): Promise<{ userId: string }> {
      return requestJson("/auth/signup", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ email, password }),
      });
    },
    login(email: string, password: string): Promise<{ userId: string }> {
      return requestJson("/auth/login", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ email, password }),
      });
    },
    async logout(): Promise<void> {
      await requestJson<{ ok: boolean }>("/auth/logout", {
        method: "POST",
        headers: JSON_HEADERS,
        body: "{}",
      });
    },
    async listTenants(): Promise<TenantSummary[]> {
      const { tenants } = await requestJson<{ tenants: TenantSummary[] }>("/auth/tenants");
      return tenants;
    },
    // createTenant（POST /v1/tenants）は Task 13 で撤去: self-serve 作成廃止(裁定 9)により
    // 対応ルートが api Worker 側から消えている。作成は super コンソール専用(super-api.ts)。
    issueToken(tenantId: string): Promise<{ token: string; expiresIn: number }> {
      return requestJson("/auth/token", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ tenantId }),
      });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
