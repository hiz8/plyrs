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
  ) {
    super(`${status}: ${code}`);
    this.name = "ApiError";
  }
}

export async function throwApiError(response: Response): Promise<never> {
  let code = "unknown_error";
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") {
      code = body.error;
    }
  } catch {
    // 本文が JSON でない（ゲートウェイ応答等）場合は unknown_error のまま
  }
  throw new ApiError(response.status, code);
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
    createTenant(name: string, slug: string): Promise<{ tenantId: string }> {
      return requestJson("/v1/tenants", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name, slug }),
      });
    },
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
