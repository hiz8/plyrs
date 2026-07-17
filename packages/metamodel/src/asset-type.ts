import type { ContentTypeDefinition } from "./content-type";

// design-spec §5 論点E: アセットは独立コンテンツ型。実体は R2 オブジェクト + このメタデータ
// record であり、alt / caption はアセット内在(文脈依存にしない)。
export const ASSET_TYPE_KEY = "asset";

// 全テナント共通の固定 ID(DO 初期化時の自動登録が使う)。乱数由来ではない予約値だが、
// uuidSchema(小文字 UUID 形式)を満たす(version nibble 7 / variant nibble 8)。
export const ASSET_TYPE_ID = "00000000-0000-7000-8000-00000000a55e";

// システム管理フィールド: アップロード API(DO の system 書き込み)だけが書ける。
// クライアント経由(同期 push / HTTP writeRecord)の新規作成・変更は assetGuardHook が拒否する。
export const ASSET_SYSTEM_MANAGED_FIELD_KEYS = [
  "filename",
  "content_type",
  "size",
  "r2_key",
  "width",
  "height",
] as const;

export const ASSET_TYPE_DEFINITION: ContentTypeDefinition = {
  id: ASSET_TYPE_ID,
  key: ASSET_TYPE_KEY,
  name: "アセット",
  source: "system",
  // version はサーバー管理(registerContentTypeCore が採番)。スキーマが positive int を
  // 要求するため 1 を運ぶだけ。
  version: 1,
  fields: [
    { key: "filename", type: "text", required: true, config: { maxLength: 256 } },
    { key: "content_type", type: "text", required: true, config: { maxLength: 256 } },
    { key: "size", type: "number", required: true, config: { integer: true } },
    { key: "r2_key", type: "text", required: true, config: { maxLength: 512 } },
    { key: "width", type: "number", config: { integer: true } },
    { key: "height", type: "number", config: { integer: true } },
    { key: "alt", type: "text", config: { maxLength: 1024 } },
    { key: "caption", type: "text", config: { maxLength: 2048 } },
  ],
};
