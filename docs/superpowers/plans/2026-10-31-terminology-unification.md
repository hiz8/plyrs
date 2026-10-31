# リポジトリ内の用語統一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue #1〜#11 の書き直しで決めた用語と、一般的でない用語の置き換えを、現行の文書・コメント・画面の文言へ反映する。

**Architecture:** 最初に用語集 `docs/glossary.md` を正本として作り、文書 → コメント → 画面の順に書き換える。コード識別子と DB スキーマは変えないので、コメントだけのタスクは「コメントを除いたコードが不変」であることを機械的に確認する。最後に Issue の本文を新しい呼び名に揃える。

**Tech Stack:** oxfmt / oxlint、esbuild(コメント除去の比較)、vitest + Testing Library、Playwright、gh CLI。

**Spec:** この計画の「用語表」と「決定事項」。元になった決定は GitHub Issue #1〜#11 の本文にある。

## 決定事項(2026-10-31 オーナー確定)

| # | 内容 | 決定 |
| --- | --- | --- |
| D1 | 過去の計画書 27 本(ロードマップを含む `docs/superpowers/plans/`) | 書き換えない。ロードマップの冒頭に用語集への案内だけ足す |
| D2 | 用語表 B | 全部採用 |
| D3 | 運営者の画面の呼び名 | 「運営管理画面」に統一する。テナント向けは「管理画面」のまま。「運営管理画面」を「管理画面」と略さない |
| D4 | 画面の文言 | 変える(Task 8) |
| D5 | 禁止語の検査の CI 追加 | 入れない |
| D6 | Issue 本文 | 新しい呼び名に更新する(Task 9) |

## 調査結果

追跡対象 792 ファイルの集計(2026-10-31、`003a3be`)。過去の計画書を除く現行部分は次のとおり。

| 場所 | ファイル数 | 対象語の件数 |
| --- | --- | --- |
| `apps/api/test` | 41 | 219 |
| `docs/design-spec.md` | 1 | 179 |
| `apps/admin` | 61 | 121 |
| `apps/api/src/projection`、`public` | 16 | 120 |
| `packages` | 36 | 97 |
| `apps/api/src/do`、`tenant-do.ts` | 15 | 87 |
| `apps/api/src` の残り | 28 | 60 |
| `docs/admin-ux` | 8 | 49 |
| `docs/tech-selection.md` | 1 | 20 |
| `CLAUDE.md`、`docs/deploy.md`、`.design-sync`、`wrangler.jsonc`、`apps/e2e` | 8 | 31 |

件数は「素の」「緑」など誤検出を含む候補の総数で、実際の置き換え数より多い。

## 用語表 A: Issue で決定済み

| 現在の語 | 新しい語 | 補足 |
| --- | --- | --- |
| 墓標 | `projection_tombstones`(の行) | 訳語を付けない |
| 投影 D1、公開投影 D1、共有投影 | 公開用 DB | 初出で `PROJECTION_DB` を添える |
| 投影する、投影更新 | 公開用 DB へ反映する、反映 | |
| 投影行、投影ジョブ、投影ペイロード | 公開用 DB の行、反映ジョブ、反映用ペイロード | |
| records 投影、relations 投影 | `projected_records`、`projected_relations` | テーブルを指す場合 |
| 再投影(ジョブ) | 公開用 DB の再構築(ジョブ) | Review Focus 1、2 を参照 |
| 凍結 embed、凍結埋め込み、凍結 URL | アセットの埋め込み情報、埋め込み URL | |
| 凍結投影 | 公開版に保存 | `apps/api/src/do/publish.ts:57` など |
| 写し(公開版を指すもの) | スナップショット | |
| 裁定(名詞) | 決定 | `裁定 10` は `決定 10` に。番号は維持する |
| 裁定する、裁く(競合) | 判定する | `docs/design-spec.md` §10 |
| 運営コンソール、特権コンソール | 運営管理画面 | D3。Issue の「管理コンソール」も同じ |

## 用語表 B: 検討候補(D2)

| 現在の語 | 提案 | 備考 |
| --- | --- | --- |
| 真実源 | 正本 | 用語集に source of truth と併記 |
| 申し送り | 引き継ぎ事項 | 過去の計画書の見出しを引用する場合は原文のまま |
| 歩き、ウォーク | 公開用 DB の再構築の実行(1 回分) | テスト名の英語 `walks` は変えない |
| 先発、後発 | 先に始まった、後から始まった | |
| 掃く | 削除する | |
| 幽霊行 | 残骸の行 | `sidebar.test.tsx:218` のテストデータは対象外 |
| 焼く | コードに直接定義する、保存する | 文脈で選ぶ |
| 畳む | まとめる、変換する | 文脈で選ぶ |
| 相乗り | 同時に更新する | |
| 昇格(実カラムへ) | 専用カラムへの切り出し | `do/health.ts` の「システム型への昇格」は「切り替え」 |
| 寛容読み | tolerant read | `CLAUDE.md` の表記に揃える |
| 遅延適合 | 遅延マイグレーション | |
| 再武装 | 再設定 | alarm の文脈 |
| 防波堤 | 防御策 | |
| 着地 | 届く、適用される、遷移する | 文脈で選ぶ |
| 張り替え | 入れ替え | |
| 排出 | 送出 | outbox の文脈 |
| 自己連鎖 | 次のジョブを自分で送る | |
| 世代番号、publish 世代 | `publish_seq` | `sync.ts` の世代ガードは別の意味なので対象外 |
| 実機 | 実環境 | `SidePanel` の「実機(960px 以上)」は「実際の画面」 |
| 緑(テスト) | テストが通る | 色の緑は対象外 |
| 素の | 文脈で選ぶ(直接の、未処理の、標準の) | 「要素の」を誤って置き換えない |
| 穴 | 不具合、漏れ | 「落とし穴」は対象外 |
| 様式 | 手本、書き方 | |
| 規律 | 方針 | |
| 語彙 | 指定できる値、種類 | |
| 同型 | 同じ形 | |
| 効く、効かない | 有効、機能する | オーナーの全体方針 |
| デッドレター(画面) | 失敗したジョブ | `dead_letters` と DLQ は残す |
| 孤児アセット(画面) | レコードのないファイル | 内部の「孤児」は一般的な語なので残す |
| 走査(画面) | 検索 | |
| 剥奪(画面) | メンバーから外す | |

**変えない語:** 持ち越し、見送り、論点(記号として参照される)、第1段・第2段、冪等、シェル、パンくず、確認待ち。一般的、または設計書の定義語である。

## Global Constraints

- コード識別子、DB のテーブルと列、マイグレーション、API のパスとエラーコード、キュー名、ファイル名は変えない(`reproject`、`PROJECTION_DB`、`projection/` など)。
- 英語のテスト名は変えない。Issue が `resurrection race` と `overlapping reprojection walks` を引用している。
- `§12.3`、`論点W`、`G14` などの参照記号と、章番号は維持する。
- 置換は語の一括置換ではなく、文を読んで行う。意味が変わる場合は文を書き直す。
- 過去の計画書は変更しない(D1)。この計画書自身も対象外。
- 「管理画面」はテナント向けの画面を指す。運営者の画面は必ず「運営管理画面」と書く。
- ドキュメント、コメント、コミットメッセージは日本語。件名は 50 字以内で、`commit` スキルに従う。
- `git add -A` は使わず、パスを指定する。リポジトリ直下に無関係の未追跡ファイルがある。
- 各タスクの最後に `corepack pnpm format` を実行する。コメントの長さが変わるため。`pnpm` は PATH に無いので `corepack pnpm` を使う。

**コメントのみの確認手順**(タスク内で「コメント確認」と書いたもの)。差が出たら、文字列の変更でないかを確認する。

```bash
BASE=$(git merge-base HEAD main)
ESBUILD=$(ls -d node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild | tail -1)
for f in $(git diff --name-only "$BASE" -- '*.ts' '*.tsx'); do
  diff <(git show "$BASE:$f" | "$ESBUILD" --loader=tsx --jsx=transform) \
       <("$ESBUILD" --loader=tsx --jsx=transform < "$f") >/dev/null || echo "CODE CHANGED: $f"
done
```

Expected: 何も表示されない。テストタスクでは、日本語のテスト名を変えたファイルだけ表示されてよい。

## Review Focus

1. **`再投影` の別の意味:** `docs/design-spec.md:287,418` の再投影は relations 行の張り直しで、公開用 DB の再構築ではない。「relations 行の作り直し」と書く。`:489` の「逆引き投影」も同じ系統。
2. **「再構築」の衝突:** 「管理画面 UX 再構築」が `docs/admin-ux` にある。「再構築」と略すのは、同じ段落で「公開用 DB の」と明示した後だけにする。
3. **機械置換の誤爆:** 「要素の」「落とし穴」「ゴミ箱」「確認待ち」など、部分一致する別の語を変えない。「管理画面」を「運営管理画面」に一括で変えない。
4. **画面の文言とテストのずれ:** `getByRole` の `name` と `aria-label` が文言に依存している。`super-ops`、`super-tenants`、`super-login` の各テストと `apps/e2e`(`warm-up.ts` の見出しの正規表現を含む)を文言と同時に直す。
5. **参照切れ:** 用語集から過去の計画書を引けること。コードの `決定 4` が計画書の `裁定 4` を指すことを、用語集に明記する。

---

### Task 1: 用語集を作り、CLAUDE.md から案内する

**Files:**
- Create: `docs/glossary.md`
- Modify: `CLAUDE.md`、`docs/superpowers/plans/2026-07-12-implementation-roadmap.md`(冒頭の案内のみ)

- [ ] **Step 1:** `docs/glossary.md` を作る。節は「新しい用語と意味」「旧語との対応」「コード識別子との対応」の 3 つ。確定した用語表の全行を載せ、過去の計画書の `裁定 N` がコードの `決定 N` に対応することを書く。
- [ ] **Step 2:** コード識別子との対応を書く。公開用 DB は `PROJECTION_DB` と `packages/db/src/projection.ts`、再構築は `reproject` と `startReprojection`、公開版は `published_snapshots`。
- [ ] **Step 3:** `CLAUDE.md` の冒頭の真実源の一覧に `docs/glossary.md` を足し、新しい文章は用語集に従うと書く。
- [ ] **Step 4:** ロードマップの冒頭に「このファイルと過去の計画書は実施時点の用語のまま残す。新旧の対応は用語集を参照」と足す。
- [ ] **Step 5:** `corepack pnpm format:check` が通ることを確認してコミットする。

### Task 2: 設計文書を書き換える

**Files:**
- Modify: `docs/design-spec.md`、`docs/tech-selection.md`、`docs/deploy.md`、`CLAUDE.md`

- [ ] **Step 1:** `docs/design-spec.md` を章の順に書き換える。特に §6、§7、§10、§11、§12、§15。章番号と論点記号は維持する。
- [ ] **Step 2:** 残りの 3 ファイルを書き換える。`CLAUDE.md` の `投影 D1`、`真実源`、`緑`、`実機` を含む。
- [ ] **Step 3:** 確認する。

Run: `grep -n "墓標\|投影\|裁定\|凍結\|真実源\|遅延適合" docs/design-spec.md docs/tech-selection.md docs/deploy.md CLAUDE.md`
Expected: 用語集への言及を除いて 0 件。

- [ ] **Step 4:** `corepack pnpm format` の後にコミットする。

### Task 3: UX 文書と周辺ファイルを書き換える

**Files:**
- Modify: `docs/admin-ux/*.md`、`.design-sync/NOTES.md`、`apps/api/wrangler.jsonc`、`.github/renovate.json5`

- [ ] **Step 1:** 用語表の語を書き換える。Review Focus 2 に従い、「UX 再構築」はそのまま残す。
- [ ] **Step 2:** `corepack pnpm format:check` の後にコミットする。

### Task 4: api の公開経路のコメントを書き換える

**Files:**
- Modify: `apps/api/src/projection/*`、`apps/api/src/public/*`、`apps/api/src/routes/public*.ts`

- [ ] **Step 1:** コメントを書き換える。`consumer.ts` は最も難しいので、コメントの理由づけを変えずに読み直す。`墓標` は `projection_tombstones` の行、`歩き` は用語表 B に従う。
- [ ] **Step 2:** コメント確認を実行する。Expected: 表示なし。
- [ ] **Step 3:** 単体テストを実行する。

Run: `corepack pnpm --filter @plyrs/api test`
Expected: PASS

- [ ] **Step 4:** `corepack pnpm format` の後にコミットする。

### Task 5: api の残りのコメントを書き換える

**Files:**
- Modify: `apps/api/src/do/*`、`apps/api/src/tenant-do.ts`、`apps/api/env.d.ts`、`apps/api/src` の残り(`auth`、`modules`、`ops`、`routes`、`index.ts`)

- [ ] **Step 1:** コメントを書き換える。`publish.ts:57` の凍結投影、`permissions.ts:16` の焼く、`alarms.ts` の排出に注意する。
- [ ] **Step 2:** コメント確認と `corepack pnpm --filter @plyrs/api test` を実行する。Expected: 表示なし、PASS。
- [ ] **Step 3:** `corepack pnpm format` の後にコミットする。

### Task 6: api のテストのコメントを書き換える

**Files:**
- Modify: `apps/api/test/*`、`apps/api/src/**/*.test.ts`

- [ ] **Step 1:** コメントと日本語のテスト名を書き換える。英語のテスト名は変えない。
- [ ] **Step 2:** コメント確認を実行する。Expected: 日本語のテスト名を変えたファイルだけ表示される。
- [ ] **Step 3:** `corepack pnpm --filter @plyrs/api test` を実行する。Expected: PASS。
- [ ] **Step 4:** `corepack pnpm format` の後にコミットする。

### Task 7: packages と admin のコメントを書き換える

**Files:**
- Modify: `packages/**`、`apps/admin/src/**`(文字列は変えない。例外は日本語のテスト名)、`apps/e2e/**`(コメントのみ)

- [ ] **Step 1:** コメントを書き換える。`裁定 G14` は `決定 G14` に。`apps/admin/src/lib/labels.ts` の文言には触れない。
- [ ] **Step 2:** コメント確認と `corepack pnpm -r typecheck` を実行する。Expected: 日本語のテスト名を変えたファイルだけ表示される。typecheck は PASS。
- [ ] **Step 3:** `corepack pnpm -r --filter "!@plyrs/e2e" test` を実行する。admin は分割実行が必要な場合がある。Expected: PASS。
- [ ] **Step 4:** `corepack pnpm format` の後にコミットする。

### Task 8: 運営管理画面の文言を変える(D4)

**Files:**
- Modify: `apps/admin/src/routes/super/tenants.$tenantId.tsx`、`apps/admin/src/routes/super/dlq.tsx`、`apps/admin/src/routes/super/route.tsx`、`apps/admin/src/routes/super-login.tsx`
- Test: `apps/admin/src/super-ops.test.tsx`、`apps/admin/src/super-tenants.test.tsx`、`apps/admin/src/super-login.test.tsx`、`apps/e2e/tests/*`、`apps/e2e/warm-up.ts`

| 現在の文言 | 新しい文言 |
| --- | --- |
| plyrs 運営コンソール | plyrs 運営管理画面 |
| 運営コンソールへログイン | 運営管理画面へログイン |
| 再投影 | 公開用 DB の再構築 |
| 再投影を開始 | 再構築を開始 |
| 再投影の確認 | 再構築の確認 |
| このテナントを再投影しますか? | このテナントの公開用 DB を再構築しますか? |
| 再投影を開始しました(epoch: N) | 再構築を開始しました(epoch: N) |
| 再投影を開始できませんでした | 再構築を開始できませんでした |
| DLQ(ナビと見出し) | 失敗したジョブ |
| デッドレター | 失敗したジョブ |
| 孤児アセット | レコードのないファイル |
| 孤児アセットを走査 | レコードのないファイルを検索 |
| メンバーの剥奪、剥奪に失敗しました | メンバーから外す、外せませんでした |

- [ ] **Step 1:** 3 つのテストの期待文言を新しい文言に変える。`super-login.test.tsx:100` は DLQ のリンク名、`super-tenants.test.tsx:240` はメンバーの剥奪のボタン名に依存している。
- [ ] **Step 2:** テストが失敗することを確認する。

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/super-ops.test.tsx src/super-tenants.test.tsx src/super-login.test.tsx`
Expected: FAIL(`name: "再構築を開始"` が見つからない)

- [ ] **Step 3:** 画面の文言を変える。`aria-label` と `caption` も同時に変える。
- [ ] **Step 4:** 同じテストを実行する。Expected: PASS
- [ ] **Step 5:** E2E を実行する。実行するとローカルデータが消える。

Run: `corepack pnpm --filter @plyrs/e2e test`
Expected: 全 spec が PASS

- [ ] **Step 6:** 全体を確認する。

Run: `corepack pnpm lint`、`corepack pnpm format:check`、`corepack pnpm -r typecheck`、`corepack pnpm -r --filter "!@plyrs/e2e" test`
Expected: すべて成功

- [ ] **Step 7:** `corepack pnpm format` の後にコミットする。

### Task 9: Issue の本文を揃える(D6)

統合後に行う。オーナーは D6 で更新を承認済み。

**Files:** なし(GitHub Issue #1〜#11)

- [ ] **Step 1:** 本文を取得し、次を探す。

```bash
for n in 1 2 3 4 5 6 7 8 9 10 11; do
  gh issue view $n --json body -q .body | grep -n "投影 D1\|再投影\|墓標\|凍結 embed\|管理コンソール\|裁定" | sed "s/^/#$n: /"
done
```

- [ ] **Step 2:** 注記の「ドキュメントやコードのコメントでは〜と呼んでいます」を「過去の計画書では〜と呼んでいます」に変え、「管理コンソール」を「運営管理画面」に、残りの古い語を用語集の語に変える。計画書の見出しの引用(「裁定(2026-07-18〜19、11 点)」など)は原文のまま残す。
- [ ] **Step 3:** `gh issue edit` で反映し、取得し直して原稿との一致を確認する。
