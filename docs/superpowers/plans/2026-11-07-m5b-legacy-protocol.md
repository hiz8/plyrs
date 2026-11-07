# M5b 旧版プロトコルのクライアントの受け入れ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-07-28 より前の版(2025 年版。`initialize` から始めるクライアント)でも MCP に接続できるようにし、VS Code・Cursor・設定を変えない MCP Inspector から読み書きできるようにする。

**Architecture:** 入口(`apps/api/src/mcp/route.ts`)の順序と認可は変えず、SDK の `createMcpHandler` の `legacy` を `"reject"` から `"stateless"` に変える。2025 年版の要求は要求ごとに作る `McpServer`(同じ factory)で答え、セッションは持たない(`Mcp-Session-Id` を出さない。GET / DELETE は今までどおり 405)。stateless の旧版ではサーバーからクライアントへ問い合わせを送れないので、publish / unpublish の確認(elicitation)はできない。旧版の接続では確認に進まず、`confirmation_unavailable` で人に回す(決定 50 の扱いのまま)。JSON-RPC のバッチ(2025-03-26 の配列)は、入口のスコープ判定・ヘッダ照合・Rate Limiting が 1 要求を前提にしているので受けない。

**Tech Stack:** `@modelcontextprotocol/server` 2.4.0(`createMcpHandler` の `legacy: "stateless"`)、Hono、`@cloudflare/vitest-plugin`、Playwright。

**Spec:**

- `docs/design-spec.md` 第 16 章冒頭(準拠仕様)、16.2(入口)、16.8(publish の確認)、§14(未処理論点「旧版 MCP プロトコルのクライアントへの対応」)
- `docs/superpowers/plans/2026-11-01-mcp-roadmap.md` 4 章(未決事項)、12 章(M5a の確認で Inspector の既定が legacy だった件)

## 範囲

ロードマップ 2 章のとおり、M5 の拡張は実利用を見て順番を決める。M5a の確認(2026-11-07)で、公式の MCP Inspector と SDK v2 のクライアントの既定がまだ 2025 年版の `initialize` で、「2026-07-28 のみ」の仮置きでは設定を変えない利用者が接続できないと分かった。VS Code(Copilot Chat の MCP)と Cursor も同じ理由で接続できない見込みが高い。利用者に直接届く問題で規模も小さいので、M5b で 4 章の未決事項を決めて片付ける。

含めないもの(理由):

- 旧版の接続での publish / unpublish の確認: stateless の旧版はサーバー発の要求(`elicitation/create`)を受け取る経路が無い(SDK の互換層も「per-request legacy serving cannot receive server-to-client requests」で失敗にする)。セッションを持つ旧版の運用は、2026-07-28 の stateless 必須(決定 36)と DO の外にセッションの置き場が要る点で採らない
- 旧版の GET(SSE の通知の受け口)と DELETE: 今までどおり 405。2025 年版の仕様でも、GET の SSE を出さないサーバーは 405 を返してよい
- 提案(change set)ほか M5 の拡張: M5c 以降の計画で扱う
- VS Code / Cursor での確認: 所有者の手元の作業(下の「所有者にお願いすること」)

## Global Constraints

- **入口の順序と認可は変えない**: POST のみ → Origin → IP 単位の Rate Limiting → トークン検証 → ヘッダと本文の照合 → スコープ判定 → ツール名単位の Rate Limiting → SDK。旧版の要求も同じ順序を通る
- **バッチは入口で拒否する**(`400` + JSON-RPC `-32600`)。配列の本文はスコープ判定と Rate Limiting のキーを素通りするため(DO の `runOperation` もスコープを見るが、入口で止める)
- **旧版の接続で確認を出さない**: 要求の中身(`_meta` の能力の宣言や requestState)に関わらず、旧版の接続の publish / unpublish は `confirmation_unavailable`。文面は「旧版のプロトコルで接続しているため確認できない」と分かるものにし、2026-07-28 に切り替える対処も示す
- 計測ログ `mcp.op` に `era`(`legacy` / `modern`)を足し、旧版の利用の多さを `wrangler tail` で見られるようにする
- コメント・ドキュメント・コミットメッセージ・ツール説明は日本語、用語は `docs/glossary.md` に従う。出力で「効く/効かない」という表現を使わない
- 決定ログは 56 から。決定 56(旧版のクライアントを stateless で受ける)を本書で足す
- ブランチは `claude/project-thread-drmxhw` の 1 本、PR は 1 本(計画・実装・文書をタスクごとのコミットに分ける)
- PR の前に `pnpm lint` `pnpm format:check` `pnpm typecheck` と api の vitest を通す

## Review Focus

1. **旧版の要求が入口の判定を飛ばさない**: 旧版の `tools/call` でも、PAT のスコープ不足は業務エラー、OAuth は 403、ツール名単位の Rate Limiting が掛かること。バッチは SDK に届く前に 400 になること
2. **旧版で確認を経ずに公開されない**: 旧版の接続で `record_publish` を呼ぶと、`initialize` で elicitation を宣言していても、本文に requestState や inputResponses を付けても、公開されず `confirmation_unavailable` になること
3. **2026-07-28 の挙動が変わらない**: 既存の route / confirm / tools のテストと E2E が、そのまま通ること

---

## ファイル構成

| ファイル                                           | 責務                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/api/src/mcp/route.ts`                        | 変更。`legacy: "stateless"`、バッチの拒否、factory の `ctx.era` を server に渡す |
| `apps/api/src/mcp/server.ts`                       | 変更。`McpServerDeps.era`、`mcp.op` の `era`、旧版の接続の確認を止める           |
| `apps/api/src/mcp/confirm.ts`                      | 変更。旧版の接続の `confirmation_unavailable` の文面                             |
| `apps/api/test/mcp-route.test.ts`                  | 変更。旧版の initialize / tools/list / tools/call / スコープ不足 / バッチ        |
| `apps/api/test/mcp-confirm.test.ts`                | 変更。旧版の publish が確認に進まない                                            |
| `apps/e2e/tests/mcp-smoke.spec.ts`                 | 変更。旧版の `initialize` → `tools/list` の手順を足す                            |
| `docs/design-spec.md`                              | 変更。第 16 章冒頭・16.2・16.8・§14・決定 56                                     |
| `docs/deploy.md`                                   | 変更。3.5 の Inspector の注記、VS Code / Cursor の接続手順、「M5b の確認」       |
| `docs/superpowers/plans/2026-11-01-mcp-roadmap.md` | 変更。2 章 M5b、4 章の状態、6 章、13 章(申し送り)                                |

---

## Task 1: 旧版の要求を stateless で受ける

**Files:** `apps/api/src/mcp/route.ts`、`apps/api/src/mcp/server.ts`、`apps/api/src/mcp/confirm.ts`、`apps/api/test/mcp-route.test.ts`、`apps/api/test/mcp-confirm.test.ts`

- [ ] **Step 1: 失敗するテストを書く**(`mcp-route.test.ts`)
  - 既存の「廃止済みの initialize は受けない」を置き換え、2025-11-25 の `initialize` が 200 で `protocolVersion: "2025-11-25"` と `serverInfo.name: "plyrs"` を返し、`mcp-session-id` を出さないこと
  - 2025-03-26 の `initialize` も 200(SDK の旧版の一覧に従う)
  - `notifications/initialized` が 202
  - 封筒なしの `tools/list` が読み取りの 7 ツールを先頭に返し、`tools/call type_list` が成功すること
  - `record:read` だけの PAT で封筒なしの `tools/call record_create` が業務エラー `insufficient_scope`
  - 配列の本文が 400 + `-32600`(SDK に届かない。`MCP_LIMITER` を呼ばない)
- [ ] **Step 2: テストが落ちることを確かめる**

  Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/mcp-route.test.ts`

- [ ] **Step 3: 実装**
  - `route.ts`: 本文を読んだ直後に `Array.isArray(body)` を 400 / `-32600` にする。`createMcpHandler((ctx) => buildMcpServer({ ..., era: ctx.era }), { legacy: "stateless", ... })`。コメントの「仕様 2026-07-28 のみ」を決定 56 に書き換える
  - `server.ts`: `McpServerDeps` に `era: "legacy" | "modern"`。`logOperation` に `era`。`callConfirmed` は `deps.era === "legacy"` なら `confirmOperation` に `legacyEra: true` を渡す
  - `confirm.ts`: `ConfirmArgs.legacyEra` を足し、真なら state・inputResponses・能力の宣言を見ずに `confirmation_unavailable`(旧版の文面)を返す
- [ ] **Step 4: confirm のテスト**(`mcp-confirm.test.ts`)。旧版の接続(`initialize` で `capabilities.elicitation` を宣言)で `record_publish` が `confirmation_unavailable`、record は公開されないこと。`confirmOperation` の単体で `legacyEra: true` が有効な state と承諾の inputResponses を付けても refused になること
- [ ] **Step 5: api の vitest 全件、lint、format:check、typecheck**
- [ ] **Step 6: コミット** `feat(api): 2025 年版の MCP クライアントを stateless で受ける(決定 56)`

## Task 2: E2E のスモークに旧版の手順を足す

**Files:** `apps/e2e/tests/mcp-smoke.spec.ts`

- [ ] **Step 1:** PAT で 2025-11-25 の `initialize` → `notifications/initialized` → `tools/list` を送り、先頭の読み取りツールが 2026-07-28 と同じであることを確かめる手順を足す(応答は SSE なので `data:` 行を読む)
- [ ] **Step 2:** `pnpm --filter @plyrs/e2e test`(手元で全 spec)
- [ ] **Step 3: コミット** `test(e2e): MCP のスモークに 2025 年版の接続を足す`

## Task 3: 文書と申し送り

**Files:** `docs/design-spec.md`、`docs/deploy.md`、`docs/superpowers/plans/2026-11-01-mcp-roadmap.md`

- [ ] **Step 1: design-spec**: 第 16 章冒頭に「2025 年版のクライアントも stateless で受ける(決定 56)」、16.2 のトランスポートにバッチの拒否と旧版の扱い、16.8 に旧版の接続は確認できず `confirmation_unavailable`、§14 の該当行を解決済みに、決定ログに 56
- [ ] **Step 2: deploy.md**: 3.5 の Inspector の注記を「既定の legacy でも接続できる。publish の確認は Modern / Auto のときだけ」に書き換え、VS Code(`.vscode/mcp.json` の `http` サーバーと `Authorization` ヘッダ)と Cursor(`~/.cursor/mcp.json` の `url` と `headers`)の PAT 接続の例を足す。3.6 に「M5b の確認」
- [ ] **Step 3: ロードマップ**: 2 章に M5b の表、4 章の「旧版プロトコルのクライアントへの対応」を決定 56 に、6 章の M5 の行、13 章(M5b 完了時の申し送り)
- [ ] **Step 4: コミット** `docs: M5b の決定 56 と接続ガイド、申し送り`

## 所有者にお願いすること(preview、マージ・デプロイ後)

手順は `docs/deploy.md` 3.6 の「M5b の確認」。結果はロードマップ 13 章に追記する。

1. MCP Inspector を既定の Protocol Era(legacy)のまま PAT で接続し、`tools/list` と `type_list` が通ること。`record_publish` は `confirmation_unavailable` で、Modern にすると確認が出ること
2. VS Code(Copilot Chat のエージェントモード)で PAT 接続し、`type_list` と `record_get` を呼べること。`record_publish` の結果(旧版なら `confirmation_unavailable`、2026-07-28 で話すなら確認が出る)を記録する
3. Cursor をお使いなら同じ確認(使っていなければ未確認のまま記録する)
4. `wrangler tail` の `mcp.op` に `era` が出ること
