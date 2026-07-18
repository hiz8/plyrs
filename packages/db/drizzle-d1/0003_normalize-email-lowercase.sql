-- Custom SQL migration file, put your code below! --
-- §6 セキュリティ束: email 小文字正規化(以後の書き込みはアプリ側 normalizeEmail が担保)。
-- 大文字小文字違いの重複が既存 D1 にあると一意制約で失敗するが、実データは開発用のみで許容(手順書に注記)。
UPDATE users SET email = lower(email);