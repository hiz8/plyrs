// §6: AUTH_LIMITER は wrangler.jsonc の unsafe ratelimit binding(実体は Miniflare がシミュレートする
// 本物の limit=10/period=60 バケット)。--no-isolate のテストランでは全ファイル・全 it が同じ
// バケットを共有するため、/auth/signup・/auth/login を叩くテストは必ずこの fake で上書きしないと
// 他テストの呼び出し数に応じて 429 が混入する(security-bundle.test.ts が検証する 429/503 応答の
// 実装と同じ形)。public-write.test.ts の fakeLimiter と同じ様式。
export function fakeLimiter(succeeds: boolean): RateLimit {
  return { limit: async () => ({ success: succeeds }) } as RateLimit;
}
