# M0-2 リッチテキスト形式(論点 A1)の試作結果

> MCP 導入の実装計画 M0-2。試作コードは `spike/mcp-richtext` ブランチの `packages/richtext-spike`(main にはマージしない)。
> 結論は design-spec 第 16.10 章と決定ログ(決定 46)に反映した。

## 結論

**(a) ProseMirror JSON のまま最上位ブロックに `attrs.id` を持たせる案を採る。** Portable Text(b)は採らない。

| 比較項目 | (a) ProseMirror JSON + `attrs.id` | (b) Portable Text |
| --- | --- | --- |
| Tiptap 全ノード種の往復(19 件) | 19 / 19 が可逆(形式を変えないので構造は不変) | 14 / 19。番号リストの `start`、1 項目に複数段落、引用内の複数段落・リスト、先頭末尾の空白が不可逆 |
| Markdown との往復(19 件) | 19 / 19 が可逆(`@tiptap/markdown` 3.31.4。独自 2 ノードはハンドラを足せば可逆) | Markdown は Tiptap 側で変換するので (a) と同じ。PT ⇄ Markdown を直接やる場合は別途 |
| Worker(DOM 無し)で動くか | Markdown 変換は `MarkdownManager` を Editor 無しで使えて DOM 不要。動作確認済み(vitest の node 環境) | 公式ツールが HTML 入出力しか持たないため HTML を経由し、`htmlToPortableText` に DOM パーサー(jsdom / linkedom 相当)が要る |
| 影響する PR | M2-1(M)1 本 + M2-2(M)1 本。計画どおり | M2-1 が 4〜5 本の L に分かれる: 変換器、メタモデル(`richTextEnvelopeSchema`)、エディタのアダプタ(編集は Tiptap のまま保存時に変換)、関係の抽出(`body-relations.ts`)、公開側(反映用ペイロードと公開 API の本文形式)。加えて design-spec 論点 A(JSON AST 採用)と tech-selection 2.7 の見直し |
| 仕様の安定性 | ProseMirror JSON は Tiptap の正本形式 | 仕様は v0.0.1 Working Draft のまま。入れ子ブロックが無い(表はカスタム、リストの入れ子は `level`) |

部分編集・ブロック単位の競合判定・生成しやすさは、いずれも「安定 ID」から来る利点であり、Portable Text に固有ではない(調査レポート A1 の見立てどおり)。(a) で安定 ID を付けられることは下の試作で確かめた。

## 試作で確かめたこと

### 1. v1 を読むときの決定的な ID 導出(`src/block-ids.ts`)

計画レビューの指摘(2026-11-01)に従い、v1 のエンベロープを読むときの最上位ブロック ID を **位置 + 内容の正規化 JSON のハッシュ**から導く純関数を書き、次を確認した。

- 同じ record を何度読んでも、JSON を作り直しても同じ ID が出る(同じ内容の段落が 2 つあっても位置が違うので別 ID)
- attrs のキー順が違っても同じ ID(キーを整列した正規形をハッシュする)
- 内容が変わると ID が変わる。前にブロックが挿入されると後続の導出 ID も変わる(位置を含めるため)。永続化で安定する
- 保存された ID があればそれを優先し、無いブロックだけ導出する。schemaVersion 2 で全ブロックに ID があれば何も導出しない(冪等)
- 重複した保存 ID(コピー&ペースト由来)は 2 つ目以降を導出で置き換える

ハッシュは FNV-1a 64bit × 2 系統(同期・WebCrypto 不要)。metamodel の純関数(クライアントと DO で共用)として置ける。衝突耐性は「同じ record 内の最上位ブロック同士を区別できればよい」用途で十分。

### 2. `@tiptap/extension-unique-id` 3.31.4 の挙動(`src/unique-id.test.ts`)

| 確認項目 | 結果 |
| --- | --- |
| ID の無い文書(v1 相当)を開く | `types` に挙げたノード種に ID が付く。付与は `onCreate`(Tiptap 3 は `setTimeout` で遅延)で、履歴に乗らない |
| 最上位ブロックだけに付くか | 付かない。`types` は「ノード種」の指定なので、箇条書きの中の `paragraph` にも付く。**「ID の契約は最上位ブロック」とし、入れ子の ID は契約外(あっても害はない)**とするのが素直 |
| ペースト(`transformPasted`)の重複 | 解消される。paste / drop の DOM イベントでフラグを立て、持ち込まれた ID を捨ててから振り直す |
| `insertContent`(プログラムからの挿入)の重複 | **解消されない**。拡張の重複解消は paste / drop と「分割で元位置が消えた」場合に限られる。MCP の `record_update` がブロックを ID 付きで送る経路では、DO 側で重複を検出して振り直す(上の `ensureTopLevelBlockIds` が担う) |
| `generateID` の差し替え | できる。決定的な導出規則と同じ関数を渡せるが、エディタ側は新規ブロックの採番なので UUID のままでよい |
| 副次的な所見 | StarterKit 3.x は `trailingNode` を含み、末尾に空段落が 1 つ足される(既存の ui のエディタも同じ)。保存形式として「末尾の空段落」が常に増えうる |

### 3. 変換忠実度(`src/fidelity.test.ts`、`RESULTS.md`)

StarterKit(見出し 1〜3)+ `recordMention` + `assetImage` の全ノード種・全マーク種 19 件を往復させ、ProseMirror のスキーマを通してから比較した(attrs の既定値を埋め、スキーマに合わない構造は例外になる)。

| ノード種 | (a) PM JSON + id | (b) Portable Text | (c) Markdown |
| --- | --- | --- | --- |
| paragraph / heading 1〜3 / marks(太字・斜体・取り消し・下線・コード)/ 重ねたマーク / link | ○ | ○ | ○ |
| bulletList(2 階層) | ○ | ○ | ○ |
| orderedList(start=3) | ○ | × `start` が 1 に | ○ |
| listItem に 2 段落 | ○ | × 1 段落に | ○ |
| blockquote(2 段落) | ○ | × 1 段落に | ○ |
| blockquote の中の箇条書き | ○ | × 引用の外に出る | ○ |
| codeBlock(language あり / なし) | ○ | ○ | ○ |
| hardBreak / horizontalRule | ○ | ○ | ○ |
| recordMention(インライン独自ノード) | ○ | ○ | ○(ハンドラを足した場合。無いと落ちる) |
| assetImage(ブロック独自ノード) | ○ | ○ | ○(同上) |
| 空段落の連続 / Markdown 記号を含む平文 | ○ | ○ | ○ |
| 先頭・末尾・連続の空白 | ○ | × 正規化される(HTML 経由の副作用) | ○ |

Portable Text の × はいずれも「ブロックの入れ子が無い」という仕様の制約から来るもので、変換器を工夫しても埋まらない(カスタムブロックで表せば Portable Text の利点を失う)。

Markdown は `@tiptap/markdown` の `MarkdownManager` を使った。`@tiptap/static-renderer` の `renderToMarkdown` も試したが出力が異なる(斜体が `_` 、下線が `<u>`、前後に改行)ので、**M2-2 は `@tiptap/markdown` に統一する**。

独自ノードの Markdown 表現は試作で次を仮置きした(M2-2 で確定):

- record 参照: Tiptap 公式の inline shortcode `[@ recordType="author" recordId="<uuid>" label="山田"]`。`@tiptap/extension-mention` 自身が同じ形の tokenizer を持つが `nodeName` が `mention` 固定なので、extend 後の名前で `createInlineMarkdownSpec` を作り直す必要がある
- 本文中画像: 標準の画像構文で href を独自スキームに `![hero.png](plyrs://asset/<uuid>)`。公式の `createAtomBlockMarkdownSpec` なら `:::assetImage {…}` 形式になる。エージェントの書きやすさで選ぶ

### 4. スキーマ外の Markdown の受け入れ(`src/markdown-input.test.ts`、`RESULTS-markdown-input.md`)

エージェントが書きそうな、語彙に無い Markdown を `MarkdownManager.parse` に通した結果。**M2-2 では変換後に必ず ProseMirror のスキーマ検証(`nodeFromJSON(...).check()`)を通し、通らなければ業務エラーで返す**必要がある。

| 入力 | 結果 |
| --- | --- |
| `#### h4`(語彙は h1〜h3) | `level: 4` の heading が生成され、スキーマ検証も通る(attrs の値域は検証されない)。M2-2 で 3 に丸めるか拒否する |
| GFM テーブル | 黙って落ちて空の doc になり、スキーマ検証で失敗する。拒否して「表は使えない」と返す |
| タスクリスト `- [ ]` | `listItem` の直下に text が入る不正な AST。スキーマ検証で失敗する |
| 外部 URL の画像 `![alt](https://…)` | doc 直下に text が残る不正な AST。スキーマ検証で失敗する。アセット取り込み(M4-5)への導線を返す |
| 生の HTML | 文字列としてそのまま段落に入る(無害) |
| 空文字 | 空の doc でスキーマ検証に失敗する。空段落 1 つに正規化する |
| `> 外\n>\n> > 内`(入れ子の引用)、`3. 三`(start=3) | 正しく変換される |

## M2 への引き継ぎ事項

1. **M2-1**: `RICH_TEXT_SCHEMA_VERSION` を 2 に上げ、`ensureTopLevelBlockIds`(試作の `block-ids.ts`)を metamodel の tolerant read に置く。定数の実体は今 `packages/ui/src/rich-text-editor.tsx` にあるので、導出関数と一緒に metamodel へ移し、ui はそれを import する(metamodel の `richTextEnvelopeSchema` は版を正の整数としか検証しないため、移さなくても v2 の読み込みは通るが、正本を 1 か所にする)。エディタには `UniqueID.configure({ types: <ブロック種>, attributeName: "id" })` を足す。ID の契約は最上位ブロックのみ。DO の書き込みでは重複 ID を振り直す
   - **エディタで v1 の record を開く経路**: クライアントは v1 の生 JSON をエディタへ渡さず、**必ず `ensureTopLevelBlockIds` を通してから渡す**。UniqueID は新規ブロックの採番だけに使う。通さないと、同じ未更新 record に対して DO 側は導出 ID、エディタ側は UniqueID の UUID となり、保存時に全ブロックの ID が入れ替わる(内容が同じでも field version が上がり、エージェント側で競合になる)
   - **確認項目**: UniqueID の `onCreate` による ID 付与(ID の無いブロックが残っていた場合)が自動保存の push を起こさないこと。起こすなら、付与を履歴に乗せない現在の挙動に加えて、同期側でも「ID だけの差分」を push しないようにする
2. **M2-2**: `@tiptap/markdown` の `MarkdownManager` を Editor 無しで Worker に置く(`packages/metamodel` か新パッケージ。ui の拡張一覧と語彙を共有する必要があるので、拡張の定義を React 非依存の場所に切り出す)。変換後にスキーマ検証を通す。独自 2 ノードの Markdown 文法を確定し、ツール説明に書く。本試作の「DOM 無しで動く」は vitest の node 環境での確認なので、M2-2 では `marked` と `@tiptap/pm` が **workerd 上(`@cloudflare/vitest-plugin`、apps/api のテスト)で動くこと**を最初に確かめる
3. **M1-6 の片方向 Markdown** は `MarkdownManager.serialize` をそのまま使えるので、M2-2 の置き換えは「parse 側と検証を足す」だけになる(計画の「捨てる実装」はさらに小さい)
4. `@tiptap/markdown` `@tiptap/extension-unique-id` `@tiptap/static-renderer`(HTML 描画が要る場合)は `@tiptap/core` と同じ版(3.31.4)に揃えて catalog に足す。`minimumReleaseAge` の 7 日に注意
5. Portable Text 系のパッケージは採らない(catalog に入れない)
6. 本書が番号で引く M1-6 / M2-1 / M2-2 / M4-5 は、MCP 導入の実装計画の索引 `2026-11-01-mcp-roadmap.md`(M0-4)の表を指す

## 試作の実行方法

```bash
git switch spike/mcp-richtext
pnpm install
pnpm --filter @plyrs/richtext-spike test   # 44 tests、RESULTS.md を再生成
```
