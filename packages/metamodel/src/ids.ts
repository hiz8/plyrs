import { z } from "zod";

// tech-selection 2.10: ID は UUIDv7 の36文字ハイフン付き小文字表記で統一して格納する。
// ソフト参照は文字列一致で解決されるため、大文字混じりの ID は静かな dangling を生む。
// 正規化ではなく拒否する（生成側のバグを隠さないため）。
export const uuidSchema = z.uuid().refine((value) => value === value.toLowerCase(), {
  message: "uuid must be lowercase",
});
