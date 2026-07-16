// 2026-07-16 裁定 #2: 短命 JWT（15 分）は JS メモリにだけ保持し、storage に置かない。
// exp の 60 秒前を切ったら /auth/token で再取得（Phase 4b 申し送りの「exp 前の先回り」）。
// ページリロード時はキャッシュが空になり、セッション cookie 経由の issueToken 1 往復で復元される。
export interface TokenManagerDeps {
  issueToken: (tenantId: string) => Promise<{ token: string; expiresIn: number }>;
  now?: () => number;
}

const REFRESH_MARGIN_MS = 60_000;

export function createTokenManager({ issueToken, now = Date.now }: TokenManagerDeps) {
  const cache = new Map<string, { token: string; expiresAt: number }>();
  const inflight = new Map<string, Promise<string>>();
  return {
    async getToken(tenantId: string): Promise<string> {
      const cached = cache.get(tenantId);
      if (cached !== undefined && cached.expiresAt - now() > REFRESH_MARGIN_MS) {
        return cached.token;
      }
      const pending = inflight.get(tenantId);
      if (pending !== undefined) {
        return pending;
      }
      const promise = issueToken(tenantId)
        .then(({ token, expiresIn }) => {
          cache.set(tenantId, { token, expiresAt: now() + expiresIn * 1000 });
          inflight.delete(tenantId);
          return token;
        })
        .catch((error: unknown) => {
          inflight.delete(tenantId);
          throw error;
        });
      inflight.set(tenantId, promise);
      return promise;
    },
    clear(): void {
      cache.clear();
      inflight.clear();
    },
  };
}

export type TokenManager = ReturnType<typeof createTokenManager>;
