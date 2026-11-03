import {
  OAuthAuthorizationServer,
  type PurgeOptions,
  type PurgeResult,
} from "@cloudflare/workers-oauth-provider";
import { oauthOrigins } from "./server";

// M3-4(16.3): OAUTH_KV の期限切れ・孤児のグラントとトークンの日次掃除(KV の TTL の defense-in-depth)。
// ライブラリの purgeExpiredData は 1 回に batchSize 件ずつ見て続きの位置(cursor)を返すので、cursor を
// OAUTH_KV に残して次回はそこから続ける(残さないと毎回先頭の batchSize 件だけを見直すことになる)。
// 掃くのは KV 全体で、テナント別の issuer とは無関係なので、認可サーバーのオブジェクトは掃除のためだけに
// テナント無しの issuer / resource で組む。

export const PURGE_CURSOR_KEY = "purge-cursor";
const BATCH_SIZE = 100;

const NOTHING: PurgeResult = {
  grantsChecked: 0,
  grantsPurged: 0,
  tokensChecked: 0,
  tokensPurged: 0,
  done: true,
};

export async function purgeOAuthData(
  env: Env,
  options: Pick<PurgeOptions, "batchSize"> = {},
): Promise<PurgeResult> {
  const origins = oauthOrigins(env);
  if (origins === null) {
    return NOTHING;
  }
  const server = new OAuthAuthorizationServer<Env>({
    issuer: `${origins.adminOrigin}/oauth`,
    resources: [`${origins.apiOrigin}/mcp`],
  });
  const cursor = (await env.OAUTH_KV.get(PURGE_CURSOR_KEY)) ?? undefined;
  let result: PurgeResult;
  try {
    result = await server.purgeExpiredData(env, {
      batchSize: options.batchSize ?? BATCH_SIZE,
      cursor,
    });
  } catch (error) {
    // レビュー修正(Important 3): 保存した cursor が無効(KV の list cursor の失効など)でも翌日以降も同じ
    // cursor で失敗し続けないよう、失敗したら cursor を捨てて次回は先頭から始める
    await env.OAUTH_KV.delete(PURGE_CURSOR_KEY);
    throw error;
  }
  if (result.cursor !== undefined) {
    await env.OAUTH_KV.put(PURGE_CURSOR_KEY, result.cursor);
  } else {
    await env.OAUTH_KV.delete(PURGE_CURSOR_KEY);
  }
  return result;
}
