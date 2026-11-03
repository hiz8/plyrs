-- 16.9(M2-9): 下書きを含む全文検索の索引。FTS5 の仮想テーブルは drizzle のスキーマで表せないため、
-- このファイルだけ drizzle-kit generate --custom で作って手で書く(CLAUDE.md の例外)。
-- 内容は apps/api/src/do/search.ts が records の書き込み・削除・復元のたびに張り直す派生データで、
-- 既存 record は DO 起動時の一回限りの再索引(do_config.search_indexed)と super の再索引で入れる。
-- tokenizer は trigram(日本語の分かち書きが不要。3 文字以上の問い合わせが MATCH の対象)。
CREATE VIRTUAL TABLE `records_fts` USING fts5(`record_id` UNINDEXED, `type` UNINDEXED, `text`, tokenize = 'trigram');
