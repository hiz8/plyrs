// 運営コンソール(/super-auth・/super/v1)への薄い JSON ラッパー。admin-api.ts と違い
// トークン管理はしない — cookie 認証(SameSite=Strict の super セッション cookie)なので
// Authorization ヘッダは付けず、fetch 側の credentials: "include" だけで完結する。
export class SuperApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`super api ${status}: ${code}`);
  }
}

export interface SuperApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string, body?: unknown): Promise<T>;
}

// 既定値はグローバル fetch を束縛したラッパー。素の `fetch` を既定値にすると、ブラウザで
// detached call（this 喪失）となり Illegal invocation を投げる(admin-api.ts / api-client.ts と同様)。
export function createSuperApi(baseFetch: typeof fetch = (...args) => fetch(...args)): SuperApi {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await baseFetch(path, {
      method,
      credentials: "include",
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new SuperApiError(response.status, payload.error ?? "unknown");
    }
    return (await response.json()) as T;
  }
  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    patch: (path, body) => request("PATCH", path, body),
    delete: (path, body) => request("DELETE", path, body),
  };
}
