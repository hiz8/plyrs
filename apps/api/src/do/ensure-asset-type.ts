import {
  ASSET_TYPE_DEFINITION,
  ASSET_TYPE_ID,
  contentTypeDefinitionSchema,
} from "@plyrs/metamodel";
import { loadContentTypeByKey, registerContentTypeCore } from "./content-types";

// TDD Step 7 で発覚した実バグの回避: zod の strictObject はパース結果のプロパティ順を
// スキーマ定義順(key, required, type, config)に正規化する。registerContentTypeCore が
// 保存するのはこの正規化後の値なので、DB から読み戻した existing.fields は常にこの順序を
// 持つ。一方 ASSET_TYPE_DEFINITION.fields は手書きリテラル(key, type, required, config の
// 記述順)であり、素の JSON.stringify 比較では中身が同じでも文字列が一致せず、DO が起きる
// たび(hibernation 復帰を含む)に「変更あり」と誤判定して version を無限に進めてしまう
// (sync-lifecycle.test.ts の hibernation テストで検出)。比較は同じ正規化を経た値同士で行う。
const NORMALIZED_ASSET_FIELDS = contentTypeDefinitionSchema.parse(ASSET_TYPE_DEFINITION).fields;

// Phase 8 裁定 2: asset はシステム型として全テナントへ自動登録する。DO の構築ごと
// (blockConcurrencyWhile 内)に呼ばれるため冪等が必須 — 定義が一致していれば何もしない。
// 定義を進化させるときは ASSET_TYPE_DEFINITION を変えるだけでよい(次に DO が起きた時に
// registerContentTypeCore が version をサーバー管理で進める)。
export function ensureAssetContentType(sql: SqlStorage, now: string): boolean {
  const existing = loadContentTypeByKey(sql, ASSET_TYPE_DEFINITION.key);
  if (existing !== null && existing.id !== ASSET_TYPE_ID) {
    // Phase 8 以前にユーザーが key='asset' の型を作っていたテナント。throw すると DO が
    // 永久に起動不能(テナント全損)になるため、自動登録を断念して既存機能を守る。
    // このテナントではアセット機能が使えない — 申し送りに記録済み(手動移行が必要)。
    console.error("content type key 'asset' is taken by a non-system type; skip registration");
    return false;
  }
  if (
    existing !== null &&
    existing.name === ASSET_TYPE_DEFINITION.name &&
    JSON.stringify(existing.fields) === JSON.stringify(NORMALIZED_ASSET_FIELDS)
  ) {
    return false;
  }
  const result = registerContentTypeCore(sql, ASSET_TYPE_DEFINITION, now, { allowSystem: true });
  if (!result.ok) {
    // 固定定義はスキーマ検証を常に通る。落ちるのは実装バグだけなので隠さない。
    throw new Error(`asset content type registration failed: ${result.message}`);
  }
  return true;
}
