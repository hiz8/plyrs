import { ASSET_SYSTEM_MANAGED_FIELD_KEYS, ASSET_TYPE_KEY } from "@plyrs/metamodel";
import type { BeforeWriteHook } from "./hooks";

// Phase 8 裁定 2: asset のシステム管理フィールドはアップロード API(systemWrite)だけが書ける。
// クライアント書き込みは (a) 新規作成そのもの、(b) システム管理フィールドの変更、を拒否する。
// alt / caption / status はここを素通りする(ユーザー編集可・ワークフロー軸)。
// 値の比較は JSON 文字列(draft 層と同じ手法): 対象は text/number のスカラーなので十分。
export const assetGuardHook: BeforeWriteHook = (ctx) => {
  if (ctx.contentType.key !== ASSET_TYPE_KEY || ctx.contentType.source !== "system") {
    return null;
  }
  if (ctx.systemWrite) {
    return null;
  }
  if (ctx.prev === null) {
    return {
      code: "forbidden",
      message: "asset records can only be created via the upload API",
    };
  }
  for (const key of ASSET_SYSTEM_MANAGED_FIELD_KEYS) {
    if (JSON.stringify(ctx.data[key]) !== JSON.stringify(ctx.prev.data[key])) {
      return { code: "forbidden", message: `asset field '${key}' is system-managed` };
    }
  }
  return null;
};
