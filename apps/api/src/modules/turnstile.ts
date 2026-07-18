// 論点W: 公開 write の bot 対策。Cloudflare Turnstile の siteverify を叩く。
// dev は Turnstile のダミーシークレット(常に成功: 1x0000000000000000000000000000000AA)を
// .dev.vars に置く。テストは globalThis.fetch のモックでこの URL を差し替える。
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp !== null) {
    body.set("remoteip", remoteIp);
  }
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body });
    if (!response.ok) {
      return false;
    }
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch (error) {
    // 検証系の障害は拒否側に倒す(fail-closed)
    console.error("turnstile verify failed", error);
    return false;
  }
}
