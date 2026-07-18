export type RateLimitDecision = "ok" | "limited" | "unavailable";

// §6: 認証系エンドポイントのレート制限。binding 欠落は設定事故として fail-closed
// (public-write と同じ規律)。key は IP(ローカル/テストは "unknown" に縮退)。
export async function checkAuthRateLimit(
  env: Env,
  ip: string | undefined,
): Promise<RateLimitDecision> {
  const limiter = env.AUTH_LIMITER;
  if (limiter === undefined) {
    return "unavailable";
  }
  const { success } = await limiter.limit({ key: ip ?? "unknown" });
  return success ? "ok" : "limited";
}
