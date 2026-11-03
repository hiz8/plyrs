import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PURGE_CURSOR_KEY, purgeOAuthData } from "../src/oauth/purge";
import { oauthEnv } from "./oauth-helpers";

// M3-4(16.3): OAUTH_KV の期限切れ・孤児のグラントとトークンを日次で掃く(KV の TTL の defense-in-depth)。
// 続きの位置(cursor)は OAUTH_KV の purge-cursor に残し、掃き終えたら消す。

// ライブラリの storage-schema のとおり grant:<userId>:<grantId> に、期限切れの疑似グラントを置く
// (accessTokenTTL は最小 60 秒なので、本物の発行では期限切れを作れない)
async function putExpiredGrant(): Promise<string> {
  const userId = crypto.randomUUID();
  const grantId = crypto.randomUUID();
  const key = `grant:${userId}:${grantId}`;
  await env.OAUTH_KV.put(
    key,
    JSON.stringify({
      id: grantId,
      clientId: "client-that-no-longer-exists",
      userId,
      scope: ["record:read"],
      metadata: {},
      encryptedProps: "",
      createdAt: 1,
      expiresAt: 2,
    }),
  );
  return key;
}

describe("purgeOAuthData", () => {
  it("期限切れのグラントを消し、掃き終えたら purge-cursor を消す", async () => {
    const key = await putExpiredGrant();
    let result = await purgeOAuthData(oauthEnv());
    let purged = result.grantsPurged;
    for (let i = 0; !result.done && i < 100; i++) {
      result = await purgeOAuthData(oauthEnv());
      purged += result.grantsPurged;
    }
    expect(result.done).toBe(true);
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await env.OAUTH_KV.get(key)).toBeNull();
    expect(await env.OAUTH_KV.get(PURGE_CURSOR_KEY)).toBeNull();
  });

  it("1 回で掃き終わらないときは cursor を purge-cursor に残し、次回はそこから続ける", async () => {
    await putExpiredGrant();
    await putExpiredGrant();
    const first = await purgeOAuthData(oauthEnv(), { batchSize: 1 });
    expect(first.done).toBe(false);
    expect(first.grantsChecked).toBe(1);
    expect(await env.OAUTH_KV.get(PURGE_CURSOR_KEY)).toBe(first.cursor ?? null);
    let result = first;
    for (let i = 0; !result.done && i < 500; i++) {
      result = await purgeOAuthData(oauthEnv(), { batchSize: 1 });
    }
    expect(result.done).toBe(true);
    expect(await env.OAUTH_KV.get(PURGE_CURSOR_KEY)).toBeNull();
  });

  it("ADMIN_ORIGIN / API_ORIGIN が未設定なら何もしない(done のまま)", async () => {
    const result = await purgeOAuthData(oauthEnv({ API_ORIGIN: undefined }));
    expect(result).toMatchObject({ done: true, grantsChecked: 0, tokensChecked: 0 });
  });
});
