# Phase 7: リッチテキスト Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tiptap v3 エディタで richtext フィールドを編集可能にし、AST(origin='body')の relations 再投影・本文競合の手動解決 UI・§12 必須申し送り 2 件(切断ゲート / マルチ編集者巻き戻し)を完結させる。

**Architecture:** ProseMirror JSON を `{schemaVersion: 1, doc}` エンベロープで records.data に格納する(tech-selection 2.7)。metamodel が語彙非依存の構造検証と mention 抽出の純関数を持ち、DO の書き込み経路が origin='body' を毎書き込みで張り直す(design-spec §6)。エディタ本体は packages/ui のヘッドレス構成(react-aria ToggleButton + StyleX、mention サジェストは React state のインラインリスト)。RecordForm は「マウント時 draft を基準に dirty キーだけ書き戻す」形へ再設計し(§12 必須②)、record 系 3 ルートのゲートは「初回 ready まで」に緩めて以降は接続バナーでフォームを維持する(§12 必須①)。本文競合は conflict ack → 手元 store の最新 record と突き合わせる二択ダイアログ(裁定 3、sync-protocol 拡張なし)。

**Tech Stack:** Tiptap v3(@tiptap/core・react・pm・starter-kit・extension-mention・suggestion、^3.28.0 minor 追従)、react-aria-components + StyleX、TanStack Form、Zod v4、Vitest + RTL(jsdom + ProseMirror シム)、@cloudflare/vitest-pool-workers(api 側)。

## 裁定事項(2026-07-17 確定・全タスクの前提)

1. **語彙** = 標準語彙 + record mention。StarterKit v3(見出し 1-3・段落・箇条書き/番号リスト・太字/斜体/インラインコード・コードブロック・引用・外部リンク・下線ほか)+ 汎用 record mention ノード(`recordMention`)。外部リンクは record 参照ではないため relations に投影されない — mention が origin='body' 抽出の実利を担う。
2. **保存モデル** = 明示保存ボタン(既存 RecordForm と同一 UX)。submit は ack を await して直列化されるため §8 の自己競合は実質発生しない。オートセーブ・エンジン改修(push 直列化 / ack rebase)はしない。
3. **競合 UI** = 二択ダイアログ(「自分の版で上書き保存」/「サーバー版を採用」+ 各版のテキスト抜粋)。conflict ack への `current: SyncRecord` 同梱はしない — サーバーは他者の change を ack より先に配信するため、手元 store の最新 record = サーバー現在値として突き合わせる(ロードマップ §7 のとおり)。
4. **§12 必須①** = 初回 ready までのみゲートし、以降は接続バナー表示でフォーム維持(record 系 3 ルート共通)。
5. **§12 必須②** = マウント時 draft を基準に「ユーザーが実際に変えたキーだけ」を書き戻す(RecordForm 全体の再設計。richtext に限らない)。
6. **AST 検証** = 語彙非依存の構造検証。doc が `{type: string, content?, marks?, attrs?, text?}` の再帰ツリーであることだけを metamodel で強制する(ノード型名の語彙は見ない — エディタ拡張 = スキーマ進化を metamodel 変更なしで受け入れる。§4.2 と整合)。

**スコープ外(再確認):** アセット・本文中の画像ノード(Phase 8)/ y-prosemirror / オートセーブ / conflict ack の protocol 拡張 / 手動確認バックログの代行。

## Global Constraints

- コミット件名は **50 字以内**(verify-commit-message.sh が機械拒否)。
- `@ts-expect-error` / `any` **禁止**。やむを得ない境界 cast は具体型 + 理由コメント(rpc-unwrap 様式)。
- bare `git stash` / `git stash pop` **禁止**(共有スタック)。
- node_modules へのシンボリックリンク作成禁止。sandbox 制限に当たったら回避せず停止して報告。
- リンターは oxlint、フォーマッターは oxfmt。`pnpm lint` / `pnpm format:check`(ルート)で検証。警告 0 を維持。
- apps/api は `"lib": ["ES2023"]`(DOM 型混入禁止)。admin は tsconfig.json + tsconfig.worker.json の 2 本。
- **route のテストファイルを `apps/admin/src/routes/` に置かない**(ルート生成器がルートとして解釈する)。ルートテストは `apps/admin/src/*.test.tsx` に置く。
- **本フェーズは新規ルートなし** → routeTree.gen.ts の再生成は不要(既存 3 ルートの中身だけ変える)。
- `CI=true` の pnpm install は auto-frozen。**Task 4(Tiptap 依存追加)は lockfile が変わるため、コントローラが sandbox 無効で `pnpm install --no-frozen-lockfile` を実行する**(実装サブエージェントは manifest 編集後に STATUS: NEEDS_CONTEXT で停止しコントローラへ依頼)。
- テスト実行はワークスペースルートから `pnpm --filter <pkg> test`。実出力をレポートに貼る(要約だけは不可)。
- vitest 末尾の「something prevents Vite server from exiting」は @stylexjs/unplugin + vitest 4 の既知ノイズ(exit 0 なら無視)。
- **AST 契約**: エンベロープは `{schemaVersion: 1, doc}`。mention ノードは type `"recordMention"`、attrs `{recordType, recordId, label}`(metamodel の `RECORD_MENTION_NODE_TYPE` と ui の `RECORD_MENTION_NODE_NAME` の一致を apps/admin の契約テストで固定)。
- Tiptap は catalog `^3.28.0`(tech-selection §3: stable 3.x は minor 追従可)。
- 相対 draft キー等で **生の制御文字をソースに埋めない**(`""` のエスケープ表記を使う)。
- UI 文言は日本語。日付・コピーライトの類は書かない。

## File Structure(このフェーズで触るファイルの全体像)

```
pnpm-workspace.yaml                                   # catalog に @tiptap/* 6 パッケージ追加 (Task 4)
packages/metamodel/
  src/record-schema.ts                                # richTextEnvelopeSchema の構造検証化 (Task 1)
  src/record-schema.test.ts                           # 追記 (Task 1)
  src/body-relations.ts                               # 新規: RECORD_MENTION_NODE_TYPE / extractBodyRelations (Task 2)
  src/body-relations.test.ts                          # 新規 (Task 2)
  src/index.ts                                        # export 追加 (Task 1, 2)
apps/api/
  src/do/write-record.ts                              # origin='body' 再投影の接続 (Task 3)
  test/write-record.test.ts                           # 追記 (Task 3)
packages/ui/
  package.json                                        # @tiptap/* 依存追加 (Task 4)
  vitest.setup.ts                                     # ProseMirror 用 jsdom シム (Task 4)
  src/tiptap-jsdom.test.ts                            # 新規: jsdom マウントのカナリア (Task 4)
  src/rich-text-editor.tsx                            # 新規: RichTextEditor(エディタ + ツールバー) (Task 5, 6)
  src/rich-text-editor.test.tsx                       # 新規 (Task 5, 6)
  src/record-mention.ts                               # 新規: mention ノード + suggestion 設定 (Task 6)
  src/index.ts                                        # export 追加 (Task 5, 6)
apps/admin/
  vitest.setup.ts                                     # 同じ jsdom シム (Task 4)
  src/lib/record-form-values.ts                       # richtext 変換 + dirty-only merge (Task 7)
  src/lib/record-form-values.test.ts                  # 追記 (Task 7)
  src/lib/richtext-text.ts                            # 新規: AST → プレーンテキスト抜粋 (Task 7)
  src/lib/richtext-text.test.ts                       # 新規 (Task 7)
  src/lib/mention-contract.test.ts                    # 新規: metamodel ⇄ ui のノード名契約 (Task 7)
  src/lib/sync.ts                                     # getHasSynced 追加 (Task 8)
  src/lib/sync.test.ts                                # 追記 (Task 8)
  src/lib/sync-context.tsx                            # useSyncHasSynced 追加 (Task 8)
  src/components/connection-banner.tsx                # 新規: 切断バナー (Task 8)
  src/routes/t/$tenantSlug/records/$typeKey/index.tsx      # 初回 ready ゲート化 (Task 8)
  src/routes/t/$tenantSlug/records/$typeKey/new.tsx        # 同上 (Task 8)
  src/routes/t/$tenantSlug/records/$typeKey/$recordId.tsx  # 同上 (Task 8)
  src/records-flow.test.tsx                           # §12 必須①のワイヤテスト追記 (Task 8)
  src/components/record-form.tsx                      # richtext 編集 + dirty-only + 競合処理 (Task 9)
  src/components/record-form.test.tsx                 # 追記・placeholder テスト更新 (Task 9)
  src/components/conflict-dialog.tsx                  # 新規: 本文競合の二択 UI (Task 9)
  src/richtext-flow.test.tsx                          # 新規: FakeSocket ワイヤレベル一式 (Task 10)
docs/superpowers/plans/2026-07-12-implementation-roadmap.md  # §3 行更新(計画コミット時)・申し送り(マージ後)
```

**タスク依存関係:** Task 1 → 2 → 3(metamodel → api)。Task 4 → 5 → 6(ui)。Task 7 は 1 に依存。Task 8 は独立。Task 9 は 5, 6, 7 に依存。Task 10 は 8, 9 に依存。Task 11 は最後。並列レーン: (1→2→3) と (4→5→6) と 8 は同時進行可。

**§12 必須②の構造的根拠(実装者向けの前提知識):** ワイヤの `changedFields` は sync-client の `toChange`(packages/sync-client/src/tanstack.ts)が「push しようとする record.input」と「store の最新レコード」の JSON 比較で導出する。つまりフォーム層が「触っていないキーには store 最新値をそのまま残した input」を作れば、そのキーは changedFields に載らず、他編集者の変更は巻き戻らない。エンジン改修は不要で、修正はフォーム層(Task 7, 9)に閉じる。

---

### Task 1: metamodel — richtext エンベロープの語彙非依存な構造検証(裁定 6)

**Files:**
- Modify: `packages/metamodel/src/record-schema.ts`
- Modify: `packages/metamodel/src/index.ts`
- Test: `packages/metamodel/src/record-schema.test.ts`

**Interfaces:**
- Consumes: 既存の `jsonValueSchema` / `JsonValue`(record-schema.ts 内)。
- Produces: `richTextNodeSchema: z.ZodType<RichTextNode>`、深化した `richTextEnvelopeSchema`、型 `RichTextNode` / `RichTextMark` / `RichTextEnvelope = { schemaVersion: number; doc: RichTextNode }`。Task 2 の抽出関数と Task 7 の admin 変換層がこれを使う。

- [ ] **Step 1: 失敗するテストを書く**

`packages/metamodel/src/record-schema.test.ts` の末尾に追記:

```ts
describe("richTextEnvelopeSchema (Phase 7: 語彙非依存の構造検証)", () => {
  const validDoc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "hello", marks: [{ type: "bold" }] }],
      },
    ],
  };

  it("accepts a ProseMirror-shaped tree including unknown node vocabulary", () => {
    const envelope = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [{ type: "someFutureBlock", attrs: { x: 1 }, content: [{ type: "text", text: "t" }] }],
      },
    };
    expect(richTextEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("accepts marks and preserves unknown keys on nodes (loose)", () => {
    const parsed = richTextEnvelopeSchema.safeParse({
      schemaVersion: 1,
      doc: { ...validDoc, futureKey: "kept" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect((parsed.data.doc as Record<string, unknown>)["futureKey"]).toBe("kept");
  });

  it("rejects a doc that is not a node tree", () => {
    expect(richTextEnvelopeSchema.safeParse({ schemaVersion: 1, doc: "plain" }).success).toBe(false);
    expect(richTextEnvelopeSchema.safeParse({ schemaVersion: 1, doc: { content: [] } }).success).toBe(false);
    expect(
      richTextEnvelopeSchema.safeParse({
        schemaVersion: 1,
        doc: { type: "doc", content: [{ text: "typeなし" }] },
      }).success,
    ).toBe(false);
  });

  it("rejects a non-positive or missing schemaVersion and unknown envelope keys", () => {
    expect(richTextEnvelopeSchema.safeParse({ schemaVersion: 0, doc: validDoc }).success).toBe(false);
    expect(richTextEnvelopeSchema.safeParse({ doc: validDoc }).success).toBe(false);
    expect(
      richTextEnvelopeSchema.safeParse({ schemaVersion: 1, doc: validDoc, extra: true }).success,
    ).toBe(false);
  });

  it("still validates through buildRecordInputSchema for a richtext field", () => {
    const contentType: ContentTypeDefinition = {
      id: "018f2b6a-7a0a-7000-8000-000000000001",
      key: "article",
      name: "記事",
      source: "user",
      version: 1,
      fields: [{ key: "body", type: "richtext" }],
    };
    const schema = buildRecordInputSchema(contentType);
    expect(schema.safeParse({ body: { schemaVersion: 1, doc: validDoc } }).success).toBe(true);
    expect(schema.safeParse({ body: { schemaVersion: 1, doc: 42 } }).success).toBe(false);
  });
});
```

既存 import に `richTextEnvelopeSchema` / `buildRecordInputSchema` / `ContentTypeDefinition` が無ければ足す(ファイル冒頭の import 群を確認して合わせる)。

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: FAIL(`doc: "plain"` が現行の不透明 JSON スキーマでは success になるため `rejects a doc that is not a node tree` が落ちる)

- [ ] **Step 3: 実装**

`packages/metamodel/src/record-schema.ts` の現行ブロック:

```ts
// tech-selection 2.7: AST ルートに schemaVersion を刻む。doc（ProseMirror JSON）は
// この層では不透明な JSON 値。ノード構造の検証は richtext 実装フェーズで深める。
export const richTextEnvelopeSchema = z.strictObject({
  schemaVersion: z.number().int().positive(),
  doc: jsonValueSchema,
});
```

を次に置き換える:

```ts
// tech-selection 2.7: AST ルートに schemaVersion を刻む。
// 裁定 6(2026-07-17): doc は「語彙非依存の構造検証」— ノード型名の語彙(heading 等)は
// 検証しない(エディタ拡張 = スキーマ進化を metamodel の変更なしに受け入れる。§4.2 の
// 寛容 read と同じ思想)が、ツリー構造(type: string を持つノードの再帰)だけは強制し、
// DO 側の relations 抽出(body-relations.ts)が壊れた形の doc を受け取らないことを保証する。
export interface RichTextMark {
  type: string;
  attrs?: Record<string, JsonValue> | undefined;
}

export interface RichTextNode {
  type: string;
  content?: RichTextNode[] | undefined;
  marks?: RichTextMark[] | undefined;
  attrs?: Record<string, JsonValue> | undefined;
  text?: string | undefined;
}

// looseObject: ProseMirror が将来 JSON 表現にキーを足しても破棄も拒否もしない(遅延適合)
const richTextMarkSchema: z.ZodType<RichTextMark> = z.looseObject({
  type: z.string().min(1),
  attrs: z.record(z.string(), jsonValueSchema).optional(),
});

export const richTextNodeSchema: z.ZodType<RichTextNode> = z.lazy(() =>
  z.looseObject({
    type: z.string().min(1),
    content: z.array(richTextNodeSchema).optional(),
    marks: z.array(richTextMarkSchema).optional(),
    attrs: z.record(z.string(), jsonValueSchema).optional(),
    text: z.string().optional(),
  }),
);

export const richTextEnvelopeSchema = z.strictObject({
  schemaVersion: z.number().int().positive(),
  doc: richTextNodeSchema,
});

export type RichTextEnvelope = z.infer<typeof richTextEnvelopeSchema>;
```

注意(実装上の逃げ道、placeholder ではなく contingency): typescript 7.0.2 で `z.ZodType<RichTextNode>` への looseObject 代入が input 型で拒否された場合は、`jsonValueSchema` と同じく明示アノテーション側を `z.ZodType<RichTextNode, unknown>` に広げて解決する(意味は同一)。

`packages/metamodel/src/index.ts` の record-schema export ブロックに追記:

```ts
export {
  buildFieldValueSchema,
  buildRecordInputSchema,
  jsonValueSchema,
  relationRefSchema,
  richTextEnvelopeSchema,
  richTextNodeSchema,
  splitRecordInput,
  type JsonValue,
  type RelationRef,
  type RichTextEnvelope,
  type RichTextMark,
  type RichTextNode,
  type SplitRecordInput,
} from "./record-schema";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: PASS(既存 46 + 新規 5)

- [ ] **Step 5: typecheck と lint**

Run: `pnpm --filter @plyrs/metamodel typecheck && pnpm lint`
Expected: エラー 0・警告 0

- [ ] **Step 6: コミット**

```bash
git add packages/metamodel/src/record-schema.ts packages/metamodel/src/record-schema.test.ts packages/metamodel/src/index.ts
git commit -m "feat: validate richtext doc structure in metamodel"
```

---

### Task 2: metamodel — AST → relations(origin='body')抽出の純関数

**Files:**
- Create: `packages/metamodel/src/body-relations.ts`
- Modify: `packages/metamodel/src/index.ts`
- Test: `packages/metamodel/src/body-relations.test.ts`

**Interfaces:**
- Consumes: Task 1 の `richTextEnvelopeSchema` / `RichTextNode`、既存の `uuidSchema` / `ContentTypeDefinition` / `RelationRef`。
- Produces: `RECORD_MENTION_NODE_TYPE = "recordMention"`、`extractBodyRelations(contentType: ContentTypeDefinition, data: Record<string, unknown>): BodyRelationWrite[]`(`BodyRelationWrite = { fieldKey: string; refs: RelationRef[] }`)。Task 3 の DO 書き込み経路が使う。

- [ ] **Step 1: 失敗するテストを書く**

`packages/metamodel/src/body-relations.test.ts` を新規作成:

```ts
import { describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "./content-type";
import { extractBodyRelations, RECORD_MENTION_NODE_TYPE } from "./body-relations";

const UUID_A = "018f2b6a-7a0a-7000-8000-00000000000a";
const UUID_B = "018f2b6a-7a0a-7000-8000-00000000000b";

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "body", type: "richtext" },
    { key: "summary", type: "richtext" },
  ],
};

function mention(recordType: string, recordId: string, label = "x") {
  return { type: RECORD_MENTION_NODE_TYPE, attrs: { recordType, recordId, label } };
}

function envelope(...nodes: unknown[]) {
  return {
    schemaVersion: 1,
    doc: { type: "doc", content: [{ type: "paragraph", content: nodes }] },
  };
}

describe("extractBodyRelations", () => {
  it("collects mention refs per richtext field in document order", () => {
    const data = {
      title: "t",
      body: envelope(mention("author", UUID_A), { type: "text", text: " と " }, mention("note", UUID_B)),
      summary: envelope(mention("author", UUID_B)),
    };
    expect(extractBodyRelations(articleType, data)).toEqual([
      { fieldKey: "body", refs: [{ type: "author", id: UUID_A }, { type: "note", id: UUID_B }] },
      { fieldKey: "summary", refs: [{ type: "author", id: UUID_B }] },
    ]);
  });

  it("dedupes the same reference keeping the first occurrence", () => {
    const data = { body: envelope(mention("author", UUID_A), mention("author", UUID_A)) };
    expect(extractBodyRelations(articleType, data)).toEqual([
      { fieldKey: "body", refs: [{ type: "author", id: UUID_A }] },
    ]);
  });

  it("finds mentions in nested block structures", () => {
    const data = {
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "blockquote",
              content: [{ type: "paragraph", content: [mention("author", UUID_A)] }],
            },
          ],
        },
      },
    };
    expect(extractBodyRelations(articleType, data)).toEqual([
      { fieldKey: "body", refs: [{ type: "author", id: UUID_A }] },
    ]);
  });

  it("skips malformed envelopes and malformed mention attrs silently", () => {
    const data = {
      body: "not an envelope",
      summary: envelope(
        mention("author", "not-a-uuid"),
        { type: RECORD_MENTION_NODE_TYPE, attrs: { recordId: UUID_A, label: "typeなし" } },
        { type: RECORD_MENTION_NODE_TYPE },
        mention("author", UUID_A),
      ),
    };
    expect(extractBodyRelations(articleType, data)).toEqual([
      { fieldKey: "summary", refs: [{ type: "author", id: UUID_A }] },
    ]);
  });

  it("returns an empty array when there are no richtext fields or no mentions", () => {
    const noRichtext: ContentTypeDefinition = { ...articleType, fields: [{ key: "title", type: "text" }] };
    expect(extractBodyRelations(noRichtext, { title: "t" })).toEqual([]);
    expect(extractBodyRelations(articleType, { body: envelope({ type: "text", text: "plain" }) })).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: FAIL with "Cannot find module './body-relations'" 相当

- [ ] **Step 3: 実装**

`packages/metamodel/src/body-relations.ts` を新規作成:

```ts
import { z } from "zod";
import type { ContentTypeDefinition } from "./content-type";
import { uuidSchema } from "./ids";
import { richTextEnvelopeSchema, type RelationRef, type RichTextNode } from "./record-schema";

// 本文中の record 参照ノードの型名。packages/ui の RECORD_MENTION_NODE_NAME と一致する
// こと(apps/admin/src/lib/mention-contract.test.ts が両者の一致を固定する)。
export const RECORD_MENTION_NODE_TYPE = "recordMention";

// mention ノードの attrs 契約: { recordType, recordId, label }。label は挿入時点の表示名の
// スナップショット(エディタ表示専用 — relations には投影しない。真実源は参照先 record)。
const mentionAttrsSchema = z.looseObject({
  recordType: z.string().min(1),
  recordId: uuidSchema,
});

export interface BodyRelationWrite {
  fieldKey: string;
  refs: RelationRef[];
}

function collectMentionRefs(node: RichTextNode, refs: RelationRef[], seen: Set<string>): void {
  if (node.type === RECORD_MENTION_NODE_TYPE) {
    const attrs = mentionAttrsSchema.safeParse(node.attrs);
    if (attrs.success) {
      // 区切りは type key にも UUID にも現れない Unit Separator(エスケープ表記で書く)
      const key = `${attrs.data.recordType}${attrs.data.recordId}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ type: attrs.data.recordType, id: attrs.data.recordId });
      }
    }
  }
  for (const child of node.content ?? []) {
    collectMentionRefs(child, refs, seen);
  }
}

// design-spec §6「本文中リンクの一元化」: data(relation 分離後)の richtext フィールドを
// 走査し、record 参照ノードを relations(origin='body')への書き込みへ写す純関数。
// 防御的に読む: エンベロープ不成立・attrs 不正のフィールド/ノードは黙って読み飛ばす
// (古い形の data が残るのは常態 — design-spec §4.2)。同一参照の重複は文書内の初出のみ残す。
// 参照先の存在は保証しない(ソフト参照 — dangling は正常系)。
export function extractBodyRelations(
  contentType: ContentTypeDefinition,
  data: Record<string, unknown>,
): BodyRelationWrite[] {
  const writes: BodyRelationWrite[] = [];
  for (const field of contentType.fields) {
    if (field.type !== "richtext") {
      continue;
    }
    const parsed = richTextEnvelopeSchema.safeParse(data[field.key]);
    if (!parsed.success) {
      continue;
    }
    const refs: RelationRef[] = [];
    collectMentionRefs(parsed.data.doc, refs, new Set());
    if (refs.length > 0) {
      writes.push({ fieldKey: field.key, refs });
    }
  }
  return writes;
}
```

`packages/metamodel/src/index.ts` の末尾(tolerant-read の export の後)に追記:

```ts
export {
  RECORD_MENTION_NODE_TYPE,
  extractBodyRelations,
  type BodyRelationWrite,
} from "./body-relations";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: PASS(新規 5 追加)

- [ ] **Step 5: typecheck と lint**

Run: `pnpm --filter @plyrs/metamodel typecheck && pnpm lint`
Expected: エラー 0・警告 0

- [ ] **Step 6: コミット**

```bash
git add packages/metamodel/src/body-relations.ts packages/metamodel/src/body-relations.test.ts packages/metamodel/src/index.ts
git commit -m "feat: extract body relations from richtext AST"
```

---

### Task 3: api — DO 書き込み経路への origin='body' 再投影の接続

**Files:**
- Modify: `apps/api/src/do/write-record.ts`
- Test: `apps/api/test/write-record.test.ts`

**Interfaces:**
- Consumes: Task 2 の `extractBodyRelations`。既存の `WriteDeps` / `rowToDefinition` / `computeChangeSet`(戻り値 `change.data` は relation 分離後の data で、richtext は data 側に残る)。
- Produces: 挙動のみ(書き込みが適用されるたびに `relations` の `origin='body'` 行が当該 record について全消し → 抽出結果で再挿入される)。同期(`loadRelationRefs`)と公開 read(include.ts)は `origin='field'` フィルタ済みで無影響、publish スナップショットは既存 SELECT が origin 込みで凍結する(どちらも本タスクでコード変更なし)。

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/write-record.test.ts` の describe("writeRecord") 内の末尾に追記(fixtures の `articleType()` には既に `body` richtext フィールドがある):

```ts
  function mentionBody(refs: Array<{ type: string; id: string }>): Record<string, unknown> {
    return {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: refs.flatMap((ref) => [
              {
                type: "recordMention",
                attrs: { recordType: ref.type, recordId: ref.id, label: "参照" },
              },
              { type: "text", text: " " },
            ]),
          },
        ],
      },
    };
  }

  async function bodyRelationRows(recordId: string) {
    return runInDurableObject(stub, async (_instance, state) =>
      state.storage.sql
        .exec<{ source_field: string; target_type: string; target_id: string; ordinal: number }>(
          "SELECT source_field, target_type, target_id, ordinal FROM relations WHERE source_id = ? AND origin = 'body' ORDER BY ordinal",
          recordId,
        )
        .toArray(),
    );
  }

  it("projects richtext mentions into relations with origin='body'", async () => {
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        {
          recordId: uuid(30),
          input: {
            ...validArticleInput(),
            body: mentionBody([
              { type: "author", id: uuid(2) },
              { type: "note", id: uuid(5) }, // 未登録型への dangling 参照も可(ソフト参照)
            ]),
          },
        },
        auth("user-a"),
      ),
    );
    expect(result.ok).toBe(true);
    expect(await bodyRelationRows(uuid(30))).toEqual([
      { source_field: "body", target_type: "author", target_id: uuid(2), ordinal: 0 },
      { source_field: "body", target_type: "note", target_id: uuid(5), ordinal: 1 },
    ]);
    // field 由来の行は独立して残る(authors 2 件 + hero 1 件)
    await runInDurableObject(stub, async (_instance, state) => {
      const fieldRows = state.storage.sql
        .exec<{ origin: string }>(
          "SELECT origin FROM relations WHERE source_id = ? AND origin = 'field'",
          uuid(30),
        )
        .toArray();
      expect(fieldRows).toHaveLength(3);
    });
  });

  it("reprojects body relations on every applied write (design-spec §6)", async () => {
    await stub.writeRecord(
      "article",
      {
        recordId: uuid(31),
        input: { ...validArticleInput(), body: mentionBody([{ type: "author", id: uuid(2) }]) },
      },
      auth("a"),
    );
    // mention を差し替え → 行が張り直される
    await stub.writeRecord(
      "article",
      {
        recordId: uuid(31),
        input: { ...validArticleInput(), body: mentionBody([{ type: "author", id: uuid(3) }]) },
      },
      auth("a"),
    );
    expect(await bodyRelationRows(uuid(31))).toEqual([
      { source_field: "body", target_type: "author", target_id: uuid(3), ordinal: 0 },
    ]);
    // mention を全部消す → 行が消える(空 doc は richTextEnvelopeSchema を満たす)
    await stub.writeRecord(
      "article",
      {
        recordId: uuid(31),
        input: {
          ...validArticleInput(),
          body: { schemaVersion: 1, doc: { type: "doc", content: [] } },
        },
      },
      auth("a"),
    );
    expect(await bodyRelationRows(uuid(31))).toEqual([]);
  });

  it("keeps richtext value in data and out of the relations diff", async () => {
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        {
          recordId: uuid(32),
          input: { ...validArticleInput(), body: mentionBody([{ type: "author", id: uuid(2) }]) },
        },
        auth("a"),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // richtext は data に残る(mention は data と relations の両方に現れる — relations は派生)
    expect(result.record.data["body"]).toMatchObject({ schemaVersion: 1 });
    expect(result.record.fieldVersions["body"]).toBe(1);
  });
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/api test -- write-record`
Expected: FAIL(origin='body' 行が 0 件のため `projects richtext mentions...` が落ちる)

- [ ] **Step 3: 実装**

`apps/api/src/do/write-record.ts`:

(a) import に `extractBodyRelations` を追加:

```ts
import {
  buildRecordInputSchema,
  extractBodyRelations,
  uuidSchema,
  WORKFLOW_STATUSES,
  type RelationRef,
  type WorkflowStatus,
} from "@plyrs/metamodel";
```

(b) 現行の再投影ブロック:

```ts
  // relations は派生データ: この record の field 由来行を全消しして張り直す（design-spec §6）。
  // 型定義から外れた旧フィールドの残骸もここで一掃される。origin='body' は Phase 7 の領分なので触れない。
  deps.sql.exec("DELETE FROM relations WHERE source_id = ? AND origin = 'field'", params.recordId);
```

のコメントを更新し、field 由来の挿入ループの**直後**(`const record: RecordSnapshot = {` の前)に body 再投影を追加する:

```ts
  // relations は派生データ: この record の field 由来行を全消しして張り直す（design-spec §6）。
  // 型定義から外れた旧フィールドの残骸もここで一掃される。
  deps.sql.exec("DELETE FROM relations WHERE source_id = ? AND origin = 'field'", params.recordId);
  for (const write of change.relationWrites) {
    write.refs.forEach((ref, ordinal) => {
      deps.sql.exec(
        "INSERT INTO relations (id, source_id, source_field, target_type, target_id, ordinal, origin) VALUES (?, ?, ?, ?, ?, ?, 'field')",
        deps.newRelationId(),
        params.recordId,
        write.fieldKey,
        ref.type,
        ref.id,
        ordinal,
      );
    });
  }

  // 本文由来の参照も同じ規約で張り直す(design-spec §6「record を書くたびに張り直す」)。
  // 抽出元は relation 分離後の data(richtext は data 側に残る)。同期の record 組み立て
  // (loadRelationRefs)と公開 read の field マージは origin='field' でフィルタ済みのため、
  // body 行が richtext フィールド値を汚染することはない。
  deps.sql.exec("DELETE FROM relations WHERE source_id = ? AND origin = 'body'", params.recordId);
  for (const write of extractBodyRelations(definition, change.data)) {
    write.refs.forEach((ref, ordinal) => {
      deps.sql.exec(
        "INSERT INTO relations (id, source_id, source_field, target_type, target_id, ordinal, origin) VALUES (?, ?, ?, ?, ?, ?, 'body')",
        deps.newRelationId(),
        params.recordId,
        write.fieldKey,
        ref.type,
        ref.id,
        ordinal,
      );
    });
  }
```

(既存の field 挿入ループはそのまま — 上記は文脈として再掲している。追加するのは DELETE origin='body' 以降のみ。)

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test -- write-record`
Expected: PASS(新規 3 追加)

- [ ] **Step 5: api 全体のテストと typecheck**

Run: `pnpm --filter @plyrs/api test && pnpm --filter @plyrs/api typecheck && pnpm lint`
Expected: 全 green・警告 0(delete-record の blanket delete は relations を source_id で消すため body 行も既存経路で消える — 回帰が出たらここを疑う)

- [ ] **Step 6: コミット**

```bash
git add apps/api/src/do/write-record.ts apps/api/test/write-record.test.ts
git commit -m "feat: reproject body relations on record writes"
```

---

### Task 4: Tiptap 依存導入 + ProseMirror 用 jsdom シム + カナリア

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/vitest.setup.ts`
- Modify: `apps/admin/vitest.setup.ts`
- Test: `packages/ui/src/tiptap-jsdom.test.ts`

**Interfaces:**
- Produces: catalog エントリ `@tiptap/{core,extension-mention,pm,react,starter-kit,suggestion}: ^3.28.0`、両パッケージの vitest.setup に Range/scrollIntoView/elementFromPoint シム。Task 5 以降のエディタ実装・テストが前提にする。

**実行注意(コントローラ向け):** manifest 編集後の `pnpm install` は lockfile 更新を伴うため、実装サブエージェントは編集完了時点で STATUS: NEEDS_CONTEXT で停止し、コントローラが sandbox 無効で `pnpm install --no-frozen-lockfile` をワークスペースルートで実行してから再開させる(6b の routeTree 二段方式と同じ)。

- [ ] **Step 1: catalog と依存を追加**

`pnpm-workspace.yaml` の catalog、`"@testing-library/user-event"` の次(アルファベット順)に追加:

```yaml
  "@tiptap/core": ^3.28.0
  "@tiptap/extension-mention": ^3.28.0
  "@tiptap/pm": ^3.28.0
  "@tiptap/react": ^3.28.0
  "@tiptap/starter-kit": ^3.28.0
  "@tiptap/suggestion": ^3.28.0
```

`packages/ui/package.json` の dependencies に追加(アルファベット順を保つ):

```json
  "dependencies": {
    "@stylexjs/stylex": "catalog:",
    "@tiptap/core": "catalog:",
    "@tiptap/extension-mention": "catalog:",
    "@tiptap/pm": "catalog:",
    "@tiptap/react": "catalog:",
    "@tiptap/starter-kit": "catalog:",
    "@tiptap/suggestion": "catalog:",
    "react": "catalog:",
    "react-aria-components": "catalog:"
  },
```

- [ ] **Step 2: STATUS: NEEDS_CONTEXT で停止 → コントローラが install**

コントローラ実行: `cd <worktree> && pnpm install --no-frozen-lockfile`
Expected: lockfile 更新・@tiptap/* 3.28.x が入る

- [ ] **Step 3: jsdom シムを両 vitest.setup に追加**

`packages/ui/vitest.setup.ts` の末尾に追記:

```ts
// --- ProseMirror(Tiptap)の jsdom シム ---
// jsdom は Range の測定 API・scrollIntoView・elementFromPoint を実装しない。ProseMirror の
// EditorView はマウント時・選択更新時にこれらを呼ぶため、ゼロ矩形/no-op の最小実装を与える。
// 座標に依存する検証はできない — エディタのテストはコマンド駆動でドキュメント状態を見る様式
// (src/rich-text-editor.test.tsx)にすること。
const zeroRect: DOMRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};

function emptyRectList(): DOMRectList {
  // jsdom に DOMRectList のコンストラクタが無いため、構造互換の空リストを境界 cast で返す
  const list = { length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] };
  return list as unknown as DOMRectList;
}

Range.prototype.getBoundingClientRect = () => zeroRect;
Range.prototype.getClientRects = emptyRectList;
Element.prototype.scrollIntoView = () => {};
Document.prototype.elementFromPoint = () => null;
```

`apps/admin/vitest.setup.ts` の末尾にも**同一ブロック**を追記する(admin のルートテストもエディタをマウントするため)。

- [ ] **Step 4: カナリアテストを書く**

`packages/ui/src/tiptap-jsdom.test.ts` を新規作成:

```ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

// compose.test.tsx が「StyleX がパイプラインでコンパイルされている」ことのカナリアであるのと
// 同様に、このテストは「jsdom 上で ProseMirror の EditorView がマウントできる」ことのカナリア。
// 落ちたら vitest.setup.ts の Range/scrollIntoView/elementFromPoint シムを疑うこと。
describe("Tiptap on jsdom (canary)", () => {
  it("mounts an editor, applies a command, and round-trips JSON", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    editor.commands.insertContent("hello");
    const json = editor.getJSON();
    expect(json.type).toBe("doc");
    expect(JSON.stringify(json)).toContain("hello");
    editor.destroy();
  });
});
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/ui test && pnpm --filter @plyrs/admin test`
Expected: PASS(ui にカナリア 1 追加、admin は既存 85 が回帰なし)

- [ ] **Step 6: typecheck / lint / format**

Run: `pnpm --filter @plyrs/ui typecheck && pnpm --filter @plyrs/admin typecheck && pnpm lint && pnpm format:check`
Expected: エラー 0・警告 0

- [ ] **Step 7: コミット**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/ui/package.json packages/ui/vitest.setup.ts packages/ui/src/tiptap-jsdom.test.ts apps/admin/vitest.setup.ts
git commit -m "feat: add tiptap v3 deps and prosemirror jsdom shims"
```

---

### Task 5: packages/ui — RichTextEditor コア(エディタ + ツールバー + リンク)

**Files:**
- Create: `packages/ui/src/rich-text-editor.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/rich-text-editor.test.tsx`

**Interfaces:**
- Consumes: Task 4 の依存とシム。既存の `stylexRenderProps` / `Button` / `TextField` / tokens。
- Produces:
  - `RichTextValue = { schemaVersion: number; doc: unknown }`
  - `RICH_TEXT_SCHEMA_VERSION = 1`
  - `RichTextEditor(props: RichTextEditorProps)` — props: `{ label: string; value: RichTextValue | undefined; onChange: (value: RichTextValue) => void; mentionCandidates?: RichTextMentionItem[]; errorMessage?: string; onEditorReady?: (editor: Editor) => void }`(mentionCandidates は Task 6 で配線されるが型は本タスクで定義する。`RichTextMentionItem` は Task 6 の record-mention.ts が定義するため、本タスクでは一時的に props から**除外**し、Task 6 で追加する)
  - 編集で `onChange({schemaVersion: 1, doc: editor.getJSON()})` が発火。`value` プロップの外部変更は `setContent`(emitUpdate: false)で反映。
  - ツールバー(role="toolbar"): 太字 / 斜体 / インラインコード / 見出し1-3 / 箇条書き / 番号リスト / 引用 / コードブロック / リンク(URL 入力パネル、空適用でリンク解除)。
  - エディタ本体は `getByRole("textbox", { name: label })` で見つかる(TextField と同じ規約)。

- [ ] **Step 1: 失敗するテストを書く**

`packages/ui/src/rich-text-editor.test.tsx` を新規作成:

```tsx
import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RICH_TEXT_SCHEMA_VERSION, RichTextEditor, type RichTextValue } from "./rich-text-editor";

function docWith(text: string): RichTextValue {
  return {
    schemaVersion: 1,
    doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  };
}

// jsdom はタイピングを contenteditable に届けられないため、テキスト操作は onEditorReady で
// 捕まえた editor へのコマンド駆動で行う(6b の「隠しネイティブ select への fireEvent」と
// 同じ「実装と同一コードパスの seam」— コマンドはキー入力と同じ transaction dispatch を通る)。
function Harness({
  initial,
  onChange,
  onReady,
}: {
  initial?: RichTextValue;
  onChange?: (value: RichTextValue) => void;
  onReady?: (editor: Editor) => void;
}) {
  const [value, setValue] = useState<RichTextValue | undefined>(initial);
  return (
    <RichTextEditor
      label="body"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      onEditorReady={onReady}
    />
  );
}

function lastValue(onChange: ReturnType<typeof vi.fn>): RichTextValue {
  const call = onChange.mock.calls[onChange.mock.calls.length - 1];
  if (call === undefined) throw new Error("onChange was not called");
  return call[0] as RichTextValue;
}

describe("RichTextEditor", () => {
  it("renders the initial content and a toolbar", async () => {
    render(<Harness initial={docWith("既存本文")} />);
    const textbox = await screen.findByRole("textbox", { name: "body" });
    expect(textbox).toHaveTextContent("既存本文");
    expect(screen.getByRole("toolbar", { name: "body の書式" })).toBeInTheDocument();
  });

  it("toggles a heading via the toolbar and emits an envelope", async () => {
    const onChange = vi.fn();
    render(<Harness initial={docWith("見出しになる")} onChange={onChange} />);
    await screen.findByRole("textbox", { name: "body" });
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "見出し1" });
    await user.click(button);
    const value = lastValue(onChange);
    expect(value.schemaVersion).toBe(RICH_TEXT_SCHEMA_VERSION);
    const doc = value.doc as { content: Array<{ type: string; attrs?: { level?: number } }> };
    expect(doc.content[0]?.type).toBe("heading");
    expect(doc.content[0]?.attrs?.level).toBe(1);
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("applies bold to a selected range", async () => {
    const onChange = vi.fn();
    let editor: Editor | null = null;
    render(
      <Harness initial={docWith("あいうえお")} onChange={onChange} onReady={(e) => (editor = e)} />,
    );
    await screen.findByRole("textbox", { name: "body" });
    if (editor === null) throw new Error("editor not ready");
    (editor as Editor).commands.setTextSelection({ from: 1, to: 6 });
    await userEvent.setup().click(screen.getByRole("button", { name: "太字" }));
    expect(JSON.stringify(lastValue(onChange).doc)).toContain('"bold"');
  });

  it("sets and clears a link through the URL panel", async () => {
    let editor: Editor | null = null;
    render(<Harness initial={docWith("リンク先")} onReady={(e) => (editor = e)} />);
    await screen.findByRole("textbox", { name: "body" });
    if (editor === null) throw new Error("editor not ready");
    (editor as Editor).commands.setTextSelection({ from: 1, to: 4 });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "リンク" }));
    await user.type(screen.getByRole("textbox", { name: "リンクURL" }), "https://example.com");
    await user.click(screen.getByRole("button", { name: "適用" }));
    expect(JSON.stringify((editor as Editor).getJSON())).toContain("https://example.com");
    // 空で適用するとリンク解除
    (editor as Editor).commands.setTextSelection({ from: 1, to: 4 });
    await user.click(screen.getByRole("button", { name: "リンク" }));
    await user.clear(screen.getByRole("textbox", { name: "リンクURL" }));
    await user.click(screen.getByRole("button", { name: "適用" }));
    expect(JSON.stringify((editor as Editor).getJSON())).not.toContain("https://example.com");
  });

  it("reflects an external value replacement without emitting onChange", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextEditor label="body" value={docWith("v1")} onChange={onChange} />,
    );
    const textbox = await screen.findByRole("textbox", { name: "body" });
    expect(textbox).toHaveTextContent("v1");
    rerender(<RichTextEditor label="body" value={docWith("v2")} onChange={onChange} />);
    expect(textbox).toHaveTextContent("v2");
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/ui test -- rich-text-editor`
Expected: FAIL with "Cannot find module './rich-text-editor'" 相当

- [ ] **Step 3: 実装**

`packages/ui/src/rich-text-editor.tsx` を新規作成:

```tsx
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  ToggleButton as RacToggleButton,
  type ToggleButtonRenderProps,
} from "react-aria-components";
import { Button } from "./button";
import { TextField } from "./text-field";
import { stylexRenderProps } from "./compose";
import { colors, spacing, typography } from "./tokens.stylex";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    fontFamily: typography.fontFamily,
  },
  label: { fontSize: typography.sizeSm, color: colors.textMuted },
  toolbar: { display: "flex", flexWrap: "wrap", gap: spacing.xs, alignItems: "center" },
  toolButton: {
    fontFamily: typography.fontFamily,
    fontSize: typography.sizeSm,
    paddingBlock: spacing.xs,
    paddingInline: spacing.sm,
    borderRadius: "4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    cursor: "pointer",
    outline: "none",
  },
  toolButtonActive: {
    backgroundColor: colors.accent,
    color: colors.accentText,
    borderColor: colors.accent,
  },
  toolHovered: { opacity: 0.9 },
  toolFocus: {
    outlineWidth: "2px",
    outlineStyle: "solid",
    outlineColor: colors.focusRing,
    outlineOffset: "1px",
  },
  linkPanel: { display: "flex", gap: spacing.sm, alignItems: "flex-end" },
  content: {
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingInline: spacing.md,
    fontSize: typography.sizeMd,
  },
  error: { fontSize: typography.sizeSm, color: colors.danger },
});

// records.data に入る AST エンベロープ(tech-selection 2.7)。doc の構造検証は
// @plyrs/metamodel の richTextEnvelopeSchema が担い、ui は中身に立ち入らない。
export interface RichTextValue {
  schemaVersion: number;
  doc: unknown;
}

export const RICH_TEXT_SCHEMA_VERSION = 1;

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

// doc は unknown(metamodel 検証済みの AST)。Tiptap の JSONContent への境界 cast は
// 「data JSON の脱出ハッチを 1 箇所に閉じ込める」規約(tech-selection 2.1)の editor 側対応物。
function docContent(value: RichTextValue | undefined): JSONContent {
  return value === undefined ? EMPTY_DOC : (value.doc as JSONContent);
}

export interface RichTextEditorProps {
  label: string;
  /** undefined = 空ドキュメントから開始 */
  value: RichTextValue | undefined;
  onChange: (value: RichTextValue) => void;
  errorMessage?: string | undefined;
  /**
   * プログラマティック制御・テスト用の口。jsdom は contenteditable へのタイピングを再現
   * できないため、テストはここで捕まえた editor へのコマンド駆動で行う(コマンドはキー入力と
   * 同じ transaction dispatch を通る — 6b の隠しネイティブ select と同型の判断)。
   */
  onEditorReady?: ((editor: Editor) => void) | undefined;
}

export function RichTextEditor({
  label,
  value,
  onChange,
  errorMessage,
  onEditorReady,
}: RichTextEditorProps) {
  // useEditor のオプションは初回マウントで確定する(deps [])。以降に変わりうる
  // コールバックは ref 経由で最新を参照する。
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false },
        }),
      ],
      content: docContent(value),
      // v3 既定と同じだが明示: transaction ごとに React を再レンダーしない。
      // ツールバーの活性状態は useEditorState が購読する。
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          // TextField と同じ getByRole("textbox", { name: label }) で見つける規約。
          // StyleX は ProseMirror が生成する DOM に届かないため、編集面の最小スタイルは
          // inline で持つ(tech-selection §1.3 の「動的スタイルは inline で逃がす」規約)。
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": label,
          style: "outline: none; min-height: 120px; padding-block: 8px;",
        },
      },
      onUpdate: ({ editor: current }) => {
        onChangeRef.current({
          schemaVersion: RICH_TEXT_SCHEMA_VERSION,
          doc: current.getJSON(),
        });
      },
    },
    [],
  );

  useEffect(() => {
    if (editor !== null) {
      onEditorReadyRef.current?.(editor);
    }
  }, [editor]);

  // 競合解決の「サーバー版を採用」等、外部からの値差し替えを反映する。編集者自身の
  // 変更(onUpdate 由来)は getJSON と一致するため setContent は走らない。
  useEffect(() => {
    if (editor === null || value === undefined) {
      return;
    }
    if (JSON.stringify(value.doc) !== JSON.stringify(editor.getJSON())) {
      editor.commands.setContent(docContent(value), { emitUpdate: false });
    }
  }, [editor, value]);

  if (editor === null) {
    return null;
  }

  return (
    <div {...stylex.props(styles.root)}>
      <span {...stylex.props(styles.label)}>{label}</span>
      <Toolbar editor={editor} label={label} />
      <EditorContent editor={editor} {...stylex.props(styles.content)} />
      {errorMessage !== undefined && <span {...stylex.props(styles.error)}>{errorMessage}</span>}
    </div>
  );
}

function Toolbar({ editor, label }: { editor: Editor; label: string }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      code: current.isActive("code"),
      heading1: current.isActive("heading", { level: 1 }),
      heading2: current.isActive("heading", { level: 2 }),
      heading3: current.isActive("heading", { level: 3 }),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      blockquote: current.isActive("blockquote"),
      codeBlock: current.isActive("codeBlock"),
      link: current.isActive("link"),
    }),
  });

  const openLinkPanel = () => {
    const attrs: Record<string, unknown> = editor.getAttributes("link");
    const href = attrs["href"];
    setLinkHref(typeof href === "string" ? href : "");
    setLinkOpen(true);
  };

  const applyLink = () => {
    const href = linkHref.trim();
    if (href === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkOpen(false);
  };

  return (
    <>
      <div role="toolbar" aria-label={`${label} の書式`} {...stylex.props(styles.toolbar)}>
        <ToolbarToggle
          label="太字"
          isActive={active.bold}
          onToggle={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </ToolbarToggle>
        <ToolbarToggle
          label="斜体"
          isActive={active.italic}
          onToggle={() => editor.chain().focus().toggleItalic().run()}
        >
          I
        </ToolbarToggle>
        <ToolbarToggle
          label="コード"
          isActive={active.code}
          onToggle={() => editor.chain().focus().toggleCode().run()}
        >
          {"</>"}
        </ToolbarToggle>
        <ToolbarToggle
          label="見出し1"
          isActive={active.heading1}
          onToggle={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </ToolbarToggle>
        <ToolbarToggle
          label="見出し2"
          isActive={active.heading2}
          onToggle={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </ToolbarToggle>
        <ToolbarToggle
          label="見出し3"
          isActive={active.heading3}
          onToggle={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          H3
        </ToolbarToggle>
        <ToolbarToggle
          label="箇条書き"
          isActive={active.bulletList}
          onToggle={() => editor.chain().focus().toggleBulletList().run()}
        >
          ・
        </ToolbarToggle>
        <ToolbarToggle
          label="番号リスト"
          isActive={active.orderedList}
          onToggle={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1.
        </ToolbarToggle>
        <ToolbarToggle
          label="引用"
          isActive={active.blockquote}
          onToggle={() => editor.chain().focus().toggleBlockquote().run()}
        >
          "
        </ToolbarToggle>
        <ToolbarToggle
          label="コードブロック"
          isActive={active.codeBlock}
          onToggle={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          {"{ }"}
        </ToolbarToggle>
        <ToolbarToggle label="リンク" isActive={active.link} onToggle={openLinkPanel}>
          🔗
        </ToolbarToggle>
      </div>
      {linkOpen && (
        <div {...stylex.props(styles.linkPanel)}>
          <TextField label="リンクURL" value={linkHref} onChange={setLinkHref} />
          <Button variant="secondary" onPress={applyLink}>
            適用
          </Button>
          <Button variant="secondary" onPress={() => setLinkOpen(false)}>
            閉じる
          </Button>
        </div>
      )}
    </>
  );
}

function ToolbarToggle({
  label,
  isActive,
  onToggle,
  children,
}: {
  label: string;
  isActive: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <RacToggleButton
      aria-label={label}
      isSelected={isActive}
      onChange={onToggle}
      className={stylexRenderProps<ToggleButtonRenderProps>((state) => [
        styles.toolButton,
        state.isSelected && styles.toolButtonActive,
        state.isHovered && styles.toolHovered,
        state.isFocusVisible && styles.toolFocus,
      ])}
    >
      {children}
    </RacToggleButton>
  );
}
```

`packages/ui/src/index.ts` に追記:

```ts
export {
  RICH_TEXT_SCHEMA_VERSION,
  RichTextEditor,
  type RichTextEditorProps,
  type RichTextValue,
} from "./rich-text-editor";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/ui test -- rich-text-editor`
Expected: PASS(5 tests)。TextField の label 参照(`getByRole("textbox", { name: "リンクURL" })`)が合わない場合は text-field.tsx の実装を読んで name 指定をそれに合わせる(コンポーネント側は変えない)。

- [ ] **Step 5: typecheck / lint / format**

Run: `pnpm --filter @plyrs/ui typecheck && pnpm lint && pnpm format:check`
Expected: エラー 0・警告 0

- [ ] **Step 6: コミット**

```bash
git add packages/ui/src/rich-text-editor.tsx packages/ui/src/rich-text-editor.test.tsx packages/ui/src/index.ts
git commit -m "feat: add headless richtext editor with toolbar"
```

---

### Task 6: packages/ui — record mention ノードとサジェスト UI

**Files:**
- Create: `packages/ui/src/record-mention.ts`
- Modify: `packages/ui/src/rich-text-editor.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/rich-text-editor.test.tsx`(追記)

**Interfaces:**
- Consumes: Task 5 の RichTextEditor。@tiptap/extension-mention + @tiptap/suggestion。
- Produces:
  - `RECORD_MENTION_NODE_NAME = "recordMention"`(metamodel の `RECORD_MENTION_NODE_TYPE` と一致 — Task 7 の契約テストで固定)
  - `RichTextMentionItem = { id: string; type: string; label: string }`
  - `createRecordMention(glue: MentionGlue)` — Mention を拡張したノード + suggestion 設定
  - RichTextEditor に `mentionCandidates?: RichTextMentionItem[]` プロップ追加。`@` 入力でインラインの候補リスト(role="listbox")が開き、クリック / ArrowUp・ArrowDown + Enter で `recordMention` ノード(attrs `{recordType, recordId, label}`)+ 直後の空白 1 つを挿入する。

- [ ] **Step 1: 失敗するテストを書く**

`packages/ui/src/rich-text-editor.test.tsx` の末尾に追記:

```tsx
import { fireEvent } from "@testing-library/react";
import type { RichTextMentionItem } from "./record-mention";
```

(import はファイル冒頭の既存 import 群にまとめる。)

```tsx
const candidates: RichTextMentionItem[] = [
  { id: "018f2b6a-7a0a-7000-8000-000000000021", type: "author", label: "山田" },
  { id: "018f2b6a-7a0a-7000-8000-000000000022", type: "author", label: "佐藤" },
  { id: "018f2b6a-7a0a-7000-8000-000000000023", type: "note", label: "山の手引き" },
];

function MentionHarness({
  onChange,
  onReady,
}: {
  onChange?: (value: RichTextValue) => void;
  onReady?: (editor: Editor) => void;
}) {
  const [value, setValue] = useState<RichTextValue | undefined>(undefined);
  return (
    <RichTextEditor
      label="body"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      mentionCandidates={candidates}
      onEditorReady={onReady}
    />
  );
}

describe("RichTextEditor mention", () => {
  it("opens a suggestion listbox on '@' and filters by the query", async () => {
    let editor: Editor | null = null;
    render(<MentionHarness onReady={(e) => (editor = e)} />);
    await screen.findByRole("textbox", { name: "body" });
    if (editor === null) throw new Error("editor not ready");
    (editor as Editor).chain().focus().insertContent("@").run();
    const listbox = await screen.findByRole("listbox", { name: "record 参照の候補" });
    expect(listbox).toHaveTextContent("山田");
    expect(listbox).toHaveTextContent("佐藤");
    (editor as Editor).chain().focus().insertContent("山").run();
    await vi.waitFor(() => {
      expect(screen.getByRole("listbox")).toHaveTextContent("山田");
      expect(screen.getByRole("listbox")).not.toHaveTextContent("佐藤");
    });
  });

  it("inserts a recordMention node with attrs when an option is clicked", async () => {
    const onChange = vi.fn();
    let editor: Editor | null = null;
    render(<MentionHarness onChange={onChange} onReady={(e) => (editor = e)} />);
    await screen.findByRole("textbox", { name: "body" });
    if (editor === null) throw new Error("editor not ready");
    (editor as Editor).chain().focus().insertContent("@").run();
    await screen.findByRole("listbox");
    await userEvent.setup().click(screen.getByRole("option", { name: /佐藤/ }));
    const json = JSON.stringify((editor as Editor).getJSON());
    expect(json).toContain('"recordMention"');
    expect(json).toContain("018f2b6a-7a0a-7000-8000-000000000022");
    expect(json).toContain('"recordType":"author"');
    expect(onChange).toHaveBeenCalled();
  });

  it("supports keyboard navigation (ArrowDown + Enter selects the second item)", async () => {
    let editor: Editor | null = null;
    render(<MentionHarness onReady={(e) => (editor = e)} />);
    const textbox = await screen.findByRole("textbox", { name: "body" });
    if (editor === null) throw new Error("editor not ready");
    (editor as Editor).chain().focus().insertContent("@").run();
    await screen.findByRole("listbox");
    fireEvent.keyDown(textbox, { key: "ArrowDown" });
    await vi.waitFor(() =>
      expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true"),
    );
    fireEvent.keyDown(textbox, { key: "Enter" });
    await vi.waitFor(() =>
      expect(JSON.stringify((editor as Editor).getJSON())).toContain(
        "018f2b6a-7a0a-7000-8000-000000000022",
      ),
    );
  });

  it("closes the listbox on Escape", async () => {
    let editor: Editor | null = null;
    render(<MentionHarness onReady={(e) => (editor = e)} />);
    const textbox = await screen.findByRole("textbox", { name: "body" });
    if (editor === null) throw new Error("editor not ready");
    (editor as Editor).chain().focus().insertContent("@").run();
    await screen.findByRole("listbox");
    fireEvent.keyDown(textbox, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/ui test -- rich-text-editor`
Expected: FAIL with "Cannot find module './record-mention'" 相当

- [ ] **Step 3: record-mention.ts を実装**

`packages/ui/src/record-mention.ts` を新規作成:

```ts
import type { Editor, Range } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";

// 本文中の record 参照ノード。type 名と attrs 形は @plyrs/metamodel の
// extractBodyRelations との契約(apps/admin/src/lib/mention-contract.test.ts が一致を固定)。
export const RECORD_MENTION_NODE_NAME = "recordMention";

export interface RichTextMentionItem {
  /** record id(UUID) */
  id: string;
  /** content type key */
  type: string;
  /** 表示名(挿入時点のスナップショット。真実源は relations 側 — design-spec §5) */
  label: string;
}

export interface MentionSuggestState {
  items: RichTextMentionItem[];
  select: (item: RichTextMentionItem) => void;
}

// エディタコンポーネント(React)側と suggestion プラグイン(ProseMirror)側の接着面。
// candidates は編集中に増減するため getter で最新を引く。
export interface MentionGlue {
  getCandidates: () => RichTextMentionItem[];
  onState: (state: MentionSuggestState | null) => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const MAX_MENTION_ITEMS = 8;

function toSuggestState(props: SuggestionProps): MentionSuggestState {
  // SuggestionProps の generic は Mention.configure 経由では any に落ちる。items は
  // 下の items() が返した値そのものなので RichTextMentionItem[] に狭めてよい(境界 cast)。
  const items = props.items as RichTextMentionItem[];
  return { items, select: (item) => props.command(item) };
}

function insertRecordMention(editor: Editor, range: Range, props: unknown): void {
  // props は select() → suggestion command 経由で渡ってきた items() の要素(境界 cast)
  const item = props as RichTextMentionItem;
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      {
        type: RECORD_MENTION_NODE_NAME,
        attrs: { recordType: item.type, recordId: item.id, label: item.label },
      },
      { type: "text", text: " " },
    ])
    .run();
}

export function createRecordMention(glue: MentionGlue) {
  return Mention.extend({
    name: RECORD_MENTION_NODE_NAME,
    addAttributes() {
      return {
        recordType: { default: "" },
        recordId: { default: "" },
        label: { default: "" },
      };
    },
  }).configure({
    renderText({ node }) {
      return `@${String(node.attrs["label"] ?? "")}`;
    },
    // StyleX は ProseMirror が生成する DOM に届かないため inline style で逃がす
    // (tech-selection §1.3 の「動的スタイルは inline」規約)。
    renderHTML({ node }) {
      return [
        "span",
        {
          "data-record-mention": "",
          style: "background: rgba(37, 99, 235, 0.14); border-radius: 4px; padding: 0 2px;",
        },
        `@${String(node.attrs["label"] ?? "")}`,
      ];
    },
    suggestion: {
      char: "@",
      items: ({ query }) => {
        const needle = query.toLowerCase();
        return glue
          .getCandidates()
          .filter((item) => item.label.toLowerCase().includes(needle))
          .slice(0, MAX_MENTION_ITEMS);
      },
      command: ({ editor, range, props }) => {
        insertRecordMention(editor, range, props);
      },
      render: () => ({
        onStart: (props: SuggestionProps) => glue.onState(toSuggestState(props)),
        onUpdate: (props: SuggestionProps) => glue.onState(toSuggestState(props)),
        onKeyDown: (props: SuggestionKeyDownProps) => glue.onKeyDown(props.event),
        onExit: () => glue.onState(null),
      }),
    },
  });
}
```

- [ ] **Step 4: rich-text-editor.tsx に mention を配線**

`packages/ui/src/rich-text-editor.tsx` を以下のとおり変更する。

(a) import に追加:

```tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createRecordMention,
  type MentionGlue,
  type MentionSuggestState,
  type RichTextMentionItem,
} from "./record-mention";
```

(b) styles に追加:

```tsx
  mentionList: {
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    maxWidth: "320px",
  },
  mentionOption: {
    paddingBlock: spacing.xs,
    paddingInline: spacing.sm,
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  mentionOptionActive: { backgroundColor: colors.accent, color: colors.accentText },
  mentionType: { fontSize: typography.sizeSm, opacity: 0.8 },
```

(c) props に `mentionCandidates` を追加:

```tsx
export interface RichTextEditorProps {
  label: string;
  /** undefined = 空ドキュメントから開始 */
  value: RichTextValue | undefined;
  onChange: (value: RichTextValue) => void;
  /** 本文中 record 参照(@)の候補。省略時は mention 候補なし(ノード自体は常に有効) */
  mentionCandidates?: RichTextMentionItem[] | undefined;
  errorMessage?: string | undefined;
  /**
   * プログラマティック制御・テスト用の口。jsdom は contenteditable へのタイピングを再現
   * できないため、テストはここで捕まえた editor へのコマンド駆動で行う(コマンドはキー入力と
   * 同じ transaction dispatch を通る — 6b の隠しネイティブ select と同型の判断)。
   */
  onEditorReady?: ((editor: Editor) => void) | undefined;
}
```

(d) コンポーネント本体(`RichTextEditor` 関数)の ref 群の直後に suggestion 状態と glue を追加し、`useEditor` の extensions に `createRecordMention(glue)` を足す:

```tsx
export function RichTextEditor({
  label,
  value,
  onChange,
  mentionCandidates,
  errorMessage,
  onEditorReady,
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
  const candidatesRef = useRef<RichTextMentionItem[]>(mentionCandidates ?? []);
  candidatesRef.current = mentionCandidates ?? [];

  interface SuggestView extends MentionSuggestState {
    index: number;
  }
  const [suggest, setSuggest] = useState<SuggestView | null>(null);
  const suggestRef = useRef<SuggestView | null>(null);
  suggestRef.current = suggest;

  // glue は useEditor(deps [])に渡すため生成は 1 回。最新状態は ref 経由で読む。
  const glue = useMemo<MentionGlue>(
    () => ({
      getCandidates: () => candidatesRef.current,
      onState: (state) =>
        setSuggest(state === null ? null : { items: state.items, select: state.select, index: 0 }),
      onKeyDown: (event) => {
        const current = suggestRef.current;
        if (current === null || current.items.length === 0) {
          return false;
        }
        if (event.key === "ArrowDown") {
          setSuggest({ ...current, index: (current.index + 1) % current.items.length });
          return true;
        }
        if (event.key === "ArrowUp") {
          setSuggest({
            ...current,
            index: (current.index - 1 + current.items.length) % current.items.length,
          });
          return true;
        }
        if (event.key === "Enter") {
          const item = current.items[current.index];
          if (item !== undefined) {
            current.select(item);
          }
          return true;
        }
        if (event.key === "Escape") {
          setSuggest(null);
          return true;
        }
        return false;
      },
    }),
    [],
  );

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false },
        }),
        createRecordMention(glue),
      ],
      // ...(content 以降は Task 5 のまま変更なし)
```

(e) JSX の `<EditorContent ... />` の直後(errorMessage の前)に候補リストを追加:

```tsx
      {suggest !== null && suggest.items.length > 0 && (
        <div role="listbox" aria-label="record 参照の候補" {...stylex.props(styles.mentionList)}>
          {suggest.items.map((item, index) => (
            <div
              key={`${item.type}${item.id}`}
              role="option"
              aria-selected={index === suggest.index}
              {...stylex.props(
                styles.mentionOption,
                index === suggest.index && styles.mentionOptionActive,
              )}
              // click で確定する前にエディタがフォーカス喪失で suggestion を閉じないよう
              // mousedown を抑止してから click で確定する
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => suggest.select(item)}
            >
              <span>{item.label}</span>
              <span {...stylex.props(styles.mentionType)}>{item.type}</span>
            </div>
          ))}
        </div>
      )}
```

`packages/ui/src/index.ts` に追記:

```ts
export {
  RECORD_MENTION_NODE_NAME,
  type RichTextMentionItem,
} from "./record-mention";
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/ui test`
Expected: PASS(mention 4 tests 追加、既存も回帰なし)。もし `@` 入力で listbox が開かない場合、suggestion プラグインがフォーカスを要求している可能性がある — テスト側で `(editor as Editor).view.focus()` を挿入してから insertContent する(実装は変えない)。

- [ ] **Step 6: typecheck / lint / format**

Run: `pnpm --filter @plyrs/ui typecheck && pnpm lint && pnpm format:check`
Expected: エラー 0・警告 0

- [ ] **Step 7: コミット**

```bash
git add packages/ui/src/record-mention.ts packages/ui/src/rich-text-editor.tsx packages/ui/src/rich-text-editor.test.tsx packages/ui/src/index.ts
git commit -m "feat: add record mention node with suggestions"
```

---

### Task 7: admin — 値変換層の richtext 対応 + dirty-only merge(§12 必須②の土台)

**Files:**
- Modify: `apps/admin/src/lib/record-form-values.ts`
- Create: `apps/admin/src/lib/richtext-text.ts`
- Create: `apps/admin/src/lib/mention-contract.test.ts`
- Test: `apps/admin/src/lib/record-form-values.test.ts`(追記)、`apps/admin/src/lib/richtext-text.test.ts`(新規)

**Interfaces:**
- Consumes: Task 1 の `richTextEnvelopeSchema` / `RichTextEnvelope` / `RichTextNode`、Task 2 の `RECORD_MENTION_NODE_TYPE`、Task 6 の `RECORD_MENTION_NODE_NAME`(契約テストのみ)。
- Produces:
  - `asRichTextValue(value: unknown): RichTextEnvelope | undefined`
  - `isEmptyRichTextValue(value: RichTextEnvelope): boolean`
  - `draftValueEquals(a: unknown, b: unknown): boolean`
  - `fromDraftValues(contentType, draft, baseInput, initialDraft?)` — 第 4 引数を与えると「initialDraft と同値の draft キーは書かず baseInput の現在値を維持」(dirty-only)。richtext は編集対象になる(空 doc は キー削除)。
  - `richTextPlainText(value: RichTextEnvelope, limit?: number): string`(競合ダイアログの抜粋)
  Task 9 の RecordForm がすべて使う。

- [ ] **Step 1: 失敗するテストを書く(record-form-values)**

`apps/admin/src/lib/record-form-values.test.ts` の末尾に追記(import に `asRichTextValue` / `isEmptyRichTextValue` / `draftValueEquals` を追加):

```ts
const bodyEnvelope = (text: string) => ({
  schemaVersion: 1,
  doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
});

const richType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000002",
  key: "post",
  name: "投稿",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "body", type: "richtext" },
  ],
};

describe("richtext draft conversion (Phase 7)", () => {
  it("writes an edited envelope into the input", () => {
    const result = fromDraftValues(richType, { title: "t", body: bodyEnvelope("本文") }, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input["body"]).toEqual(bodyEnvelope("本文"));
  });

  it("removes the key for an empty document", () => {
    const empty = { schemaVersion: 1, doc: { type: "doc", content: [{ type: "paragraph" }] } };
    const result = fromDraftValues(richType, { title: "t", body: empty }, { body: bodyEnvelope("旧") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("body" in result.input).toBe(false);
  });

  it("removes the key for a non-envelope draft value", () => {
    const result = fromDraftValues(richType, { title: "t", body: "garbage" }, { body: bodyEnvelope("旧") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("body" in result.input).toBe(false);
  });
});

describe("dirty-only merge (§12 必須②)", () => {
  it("keeps the latest base value for untouched keys", () => {
    const initial = toDraftValues(richType, { title: "旧", body: bodyEnvelope("旧本文") });
    // 他編集者の変更が届いた後の最新 input を土台に、title だけ編集した draft を書き戻す
    const latestBase = { title: "旧", body: bodyEnvelope("他者の新本文") };
    const draft = { ...initial, title: "自分の新タイトル" };
    const result = fromDraftValues(richType, draft, latestBase, initial);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input["title"]).toBe("自分の新タイトル");
    expect(result.input["body"]).toEqual(bodyEnvelope("他者の新本文"));
  });

  it("treats a key reverted to its initial value as untouched", () => {
    const initial = toDraftValues(richType, { title: "旧", body: bodyEnvelope("旧本文") });
    const latestBase = { title: "他者のタイトル", body: bodyEnvelope("旧本文") };
    const result = fromDraftValues(richType, { ...initial }, latestBase, initial);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input["title"]).toBe("他者のタイトル");
  });

  it("still writes every field when initialDraft is omitted (create path)", () => {
    const result = fromDraftValues(richType, { title: "新規", body: bodyEnvelope("本文") }, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toEqual({ title: "新規", body: bodyEnvelope("本文") });
  });
});

describe("asRichTextValue / isEmptyRichTextValue / draftValueEquals", () => {
  it("narrows only valid envelopes", () => {
    expect(asRichTextValue(bodyEnvelope("x"))).toEqual(bodyEnvelope("x"));
    expect(asRichTextValue("nope")).toBeUndefined();
    expect(asRichTextValue({ schemaVersion: 1, doc: 42 })).toBeUndefined();
  });

  it("detects empty documents", () => {
    expect(
      isEmptyRichTextValue({ schemaVersion: 1, doc: { type: "doc", content: [] } }),
    ).toBe(true);
    expect(
      isEmptyRichTextValue({ schemaVersion: 1, doc: { type: "doc", content: [{ type: "paragraph" }] } }),
    ).toBe(true);
    const withText = asRichTextValue(bodyEnvelope("x"));
    if (withText === undefined) throw new Error("expected envelope");
    expect(isEmptyRichTextValue(withText)).toBe(false);
  });

  it("compares drafts structurally", () => {
    expect(draftValueEquals(["a", "b"], ["a", "b"])).toBe(true);
    expect(draftValueEquals(["a", "b"], ["b", "a"])).toBe(false);
    expect(draftValueEquals(undefined, undefined)).toBe(true);
    expect(draftValueEquals(undefined, "")).toBe(false);
    expect(draftValueEquals(bodyEnvelope("x"), bodyEnvelope("x"))).toBe(true);
  });
});
```

(既存 import に `ContentTypeDefinition` 型が無ければ追加。)

- [ ] **Step 2: 失敗するテストを書く(richtext-text と契約)**

`apps/admin/src/lib/richtext-text.test.ts` を新規作成:

```ts
import { describe, expect, it } from "vitest";
import type { RichTextEnvelope } from "@plyrs/metamodel";
import { richTextPlainText } from "./richtext-text";

function envelope(doc: RichTextEnvelope["doc"]): RichTextEnvelope {
  return { schemaVersion: 1, doc };
}

describe("richTextPlainText", () => {
  it("flattens text nodes and mentions across blocks", () => {
    const value = envelope({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "題" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "著者は" },
            { type: "recordMention", attrs: { recordType: "author", recordId: "x", label: "山田" } },
            { type: "text", text: "です" },
          ],
        },
      ],
    });
    expect(richTextPlainText(value)).toBe("題 著者は @山田 です");
  });

  it("truncates long text with an ellipsis", () => {
    const value = envelope({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "あ".repeat(200) }] }],
    });
    const text = richTextPlainText(value, 10);
    expect(text).toHaveLength(11);
    expect(text.endsWith("…")).toBe(true);
  });

  it("returns an empty string for an empty document", () => {
    expect(richTextPlainText(envelope({ type: "doc", content: [] }))).toBe("");
  });
});
```

`apps/admin/src/lib/mention-contract.test.ts` を新規作成:

```ts
import { describe, expect, it } from "vitest";
import { RECORD_MENTION_NODE_TYPE } from "@plyrs/metamodel";
import { RECORD_MENTION_NODE_NAME } from "@plyrs/ui";

// エディタ(ui)が書くノード名と、DO 側抽出(metamodel)が読むノード名の契約を固定する。
// どちらかを変えるときは両方を同時に変え、このテストで一致を確かめること。
describe("record mention contract", () => {
  it("ui node name matches the metamodel extraction target", () => {
    expect(RECORD_MENTION_NODE_NAME).toBe(RECORD_MENTION_NODE_TYPE);
  });
});
```

- [ ] **Step 3: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/admin test -- lib`
Expected: FAIL(asRichTextValue 等が未定義 / richtext-text モジュールなし)

- [ ] **Step 4: 実装**

`apps/admin/src/lib/record-form-values.ts` を変更する。

(a) import を差し替え:

```ts
import {
  buildRecordInputSchema,
  richTextEnvelopeSchema,
  type ContentTypeDefinition,
  type RichTextEnvelope,
} from "@plyrs/metamodel";
```

(b) ファイル冒頭のコメント(`richtext は不透明値(編集しない — 裁定 1)`)を現状に合わせて更新:

```ts
// 動的フォームの UI 状態（draft）と records の input 形式の変換層。
// - draft: text/number/datetime/json は string、boolean は boolean、
//   multiple-select / many-relation は string[]、one-relation は合成キー string、
//   richtext は AST エンベロープそのもの(Phase 7 でエディタが編集する)。
// - 空 draft は「キーを省略」に写す（空文字列を書き込まない）。
// - baseInput の未知キーは保持(遅延適合 = design-spec §4.2)。
// - initialDraft を与えると dirty キーのみ書き戻す(§12 必須② — 2026-07-17 裁定)。
```

(c) `parseRelationDraftKey` の後にヘルパー 3 つを追加:

```ts
// richtext draft 値をエンベロープに絞る(エディタ・競合ダイアログへ渡す境界)
export function asRichTextValue(value: unknown): RichTextEnvelope | undefined {
  const parsed = richTextEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// 「空」= ブロックが無い、または唯一のブロックが中身の無い段落。ユーザーが本文を全部
// 消した状態を「キー削除」に写す UI 意味論(required richtext は G7 と同様に空を拒める)。
export function isEmptyRichTextValue(value: RichTextEnvelope): boolean {
  const content = value.doc.content ?? [];
  if (content.length === 0) {
    return true;
  }
  const only = content[0];
  return (
    content.length === 1 &&
    only !== undefined &&
    only.type === "paragraph" &&
    (only.content === undefined || only.content.length === 0)
  );
}

// draft 値の同値判定。draft は JSON 直列化可能な値(文字列/boolean/配列/エンベロープ)に
// 閉じているため JSON 文字列比較で足りる(sync-client の toChange と同じ手法)。
export function draftValueEquals(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  return left !== undefined && left === right;
}
```

(d) `fromDraftValues` のシグネチャとループ先頭、richtext ケースを変更:

```ts
export function fromDraftValues(
  contentType: ContentTypeDefinition,
  draft: DraftValues,
  baseInput: Record<string, unknown>,
  // §12 必須②(2026-07-17 裁定): 編集モードではマウント時(または直近保存時)の draft を
  // 基準に「ユーザーが実際に変えたキーだけ」を書き戻す。untouched キーは baseInput
  // (最新 record.input)の値がそのまま残り、他編集者の変更を巻き戻さない。
  // undefined(新規作成)は従来どおり全フィールドを書く。
  initialDraft?: DraftValues,
): FromDraftResult {
  // baseInput が土台: 未知キー・型定義から消えたキー・untouched キーがここから引き継がれる
  const input: Record<string, unknown> = { ...baseInput };
  const fieldErrors: Record<string, string> = {};

  const setOrOmit = (key: string, value: unknown, empty: boolean) => {
    if (empty) {
      delete input[key];
    } else {
      input[key] = value;
    }
  };

  for (const field of contentType.fields) {
    const value = draft[field.key];
    if (initialDraft !== undefined && draftValueEquals(value, initialDraft[field.key])) {
      continue; // untouched: baseInput の現在値を維持(§12 必須②)
    }
    switch (field.type) {
```

richtext ケース(現行の `// 裁定 1: richtext は編集しない。baseInput の値がそのまま残る。 break;`)を差し替え:

```ts
      case "richtext": {
        const envelope = asRichTextValue(value);
        if (envelope === undefined || isEmptyRichTextValue(envelope)) {
          delete input[field.key];
        } else {
          input[field.key] = envelope;
        }
        break;
      }
```

(それ以外の case・末尾の zod 検証は変更なし。)

`apps/admin/src/lib/richtext-text.ts` を新規作成:

```ts
import { RECORD_MENTION_NODE_TYPE, type RichTextEnvelope, type RichTextNode } from "@plyrs/metamodel";

const DEFAULT_LIMIT = 120;

// 競合ダイアログの抜粋表示用: AST をプレーンテキストへ潰す(ノード間は空白 1 つ)。
export function richTextPlainText(value: RichTextEnvelope, limit = DEFAULT_LIMIT): string {
  const parts: string[] = [];
  const walk = (node: RichTextNode): void => {
    if (typeof node.text === "string" && node.text !== "") {
      parts.push(node.text);
    }
    if (node.type === RECORD_MENTION_NODE_TYPE) {
      const label = node.attrs?.["label"];
      parts.push(`@${typeof label === "string" ? label : "?"}`);
    }
    for (const child of node.content ?? []) {
      walk(child);
    }
  };
  walk(value.doc);
  const text = parts.join(" ").replaceAll(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/admin test -- lib`
Expected: PASS(record-form-values 追加分 + richtext-text 3 + 契約 1)。record-form.test.tsx はこの時点ではまだ旧プレースホルダーのまま green(richtext draft は初期値と同値 → dirty-only では書かれず、create 経路では envelope でないため delete — どちらも従来の「透過保持/省略」と観測可能な差はない)。

- [ ] **Step 6: typecheck / lint / format**

Run: `pnpm --filter @plyrs/admin typecheck && pnpm lint && pnpm format:check`
Expected: エラー 0・警告 0

- [ ] **Step 7: コミット**

```bash
git add apps/admin/src/lib/record-form-values.ts apps/admin/src/lib/record-form-values.test.ts apps/admin/src/lib/richtext-text.ts apps/admin/src/lib/richtext-text.test.ts apps/admin/src/lib/mention-contract.test.ts
git commit -m "feat: dirty-only merge and richtext draft conversion"
```

---

### Task 8: admin — 初回 ready ゲート + 接続バナー(§12 必須①)

**Files:**
- Modify: `apps/admin/src/lib/sync.ts`
- Modify: `apps/admin/src/lib/sync-context.tsx`
- Create: `apps/admin/src/components/connection-banner.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/records/$typeKey/index.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/records/$typeKey/new.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/records/$typeKey/$recordId.tsx`
- Test: `apps/admin/src/lib/sync.test.ts`(追記)、`apps/admin/src/records-flow.test.tsx`(追記)

**Interfaces:**
- Consumes: 既存の `createTenantSync` / `SyncEngine.onReady` / `useSyncStatus`。
- Produces: `TenantSync.getHasSynced(): boolean`(初回 ready で true、以降切断しても true のまま。インスタンス寿命 = テナントレイアウトのマウント)、`useSyncHasSynced(sync)`、`ConnectionBanner({ status })`(ready なら null、それ以外は role="status" のバナー)。record 系 3 ルートは `status !== "ready"` ゲートを `!hasSynced` ゲート + バナーに置き換える。

- [ ] **Step 1: 失敗するテストを書く(sync)**

`apps/admin/src/lib/sync.test.ts` の末尾に追記(FakeSocket の import 経路は既存テストに合わせる):

```ts
it("keeps hasSynced true across a disconnect after the first ready (§12 必須①)", async () => {
  const socket = new FakeSocket();
  const sync = createTenantSync({ connect: async () => socket, reconnectDelaysMs: [0] });
  expect(sync.getHasSynced()).toBe(false);
  sync.start();
  await vi.waitFor(() =>
    expect(socket.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }),
  );
  socket.deliver({ type: "welcome", protocolVersion: 1, contentTypes: [], serverSeq: 0 });
  socket.deliver({ type: "sync", records: [], serverSeq: 0, complete: true });
  await vi.waitFor(() => expect(sync.getHasSynced()).toBe(true));
  sync.stop();
  expect(sync.getStatus()).toBe("closed");
  expect(sync.getHasSynced()).toBe(true);
});
```

- [ ] **Step 2: 失敗するテストを書く(ルート)**

`apps/admin/src/records-flow.test.tsx` の「record エディタ」describe に追記:

```tsx
  it("keeps the form mounted with unsaved input across a disconnect (§12 必須①)", async () => {
    const harness = socketHarness();
    renderAt(`/t/blog/records/article/${RECORD_1}`, harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "旧タイトル")]);

    const user = userEvent.setup();
    const input = await screen.findByRole("textbox", { name: "title" });
    await user.clear(input);
    await user.type(input, "未保存の編集");

    // 異常クローズ → engine は新しいソケットで再接続を試みる(checkpoint 10 の hello)
    harness.latest().close(1006);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(2));

    // フォームはアンマウントされず、未保存入力と再同期バナーが出る
    expect(screen.getByRole("textbox", { name: "title" })).toHaveValue("未保存の編集");
    expect(screen.getByRole("status")).toHaveTextContent(/再同期中/);

    // 再同期が完了するとバナーが消える(差分 hello は checkpoint 10)
    const socket2 = harness.latest();
    await vi.waitFor(() =>
      expect(socket2.parsed()).toContainEqual({ type: "hello", checkpoint: 10 }),
    );
    socket2.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 10,
    });
    socket2.deliver({ type: "sync", records: [], serverSeq: 10, complete: true });
    await vi.waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "title" })).toHaveValue("未保存の編集");
  });
```

- [ ] **Step 3: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/admin test -- sync records-flow`
Expected: FAIL(getHasSynced が未定義 / 切断でフォームがアンマウントされ textbox が消える)

- [ ] **Step 4: 実装**

(a) `apps/admin/src/lib/sync.ts` — インターフェースに追加:

```ts
  getStatus(): SyncStatus;
  getTypes(): ContentTypeDefinition[];
  /** 初回同期(最初の ready)が完了したか。以降は切断中も true のまま(§12 必須①)。
      インスタンスの寿命はテナントレイアウトのマウントと一致する(裁定 4)。 */
  getHasSynced(): boolean;
```

実装側:

```ts
  let status: SyncStatus = "idle";
  let types: ContentTypeDefinition[] = [];
  let hasSynced = false;
```

`onReady` の配線を差し替え:

```ts
    onReady: () => {
      hasSynced = true;
      registry.markReady();
      emit();
    },
```

戻り値に追加:

```ts
    getStatus: () => status,
    getTypes: () => types,
    getHasSynced: () => hasSynced,
```

(b) `apps/admin/src/lib/sync-context.tsx` に追加:

```tsx
export function useSyncHasSynced(sync: TenantSync): boolean {
  return useSyncExternalStore(sync.subscribe, sync.getHasSynced);
}
```

(c) `apps/admin/src/components/connection-banner.tsx` を新規作成:

```tsx
import * as stylex from "@stylexjs/stylex";
import type { SyncStatus } from "@plyrs/sync-client";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";

const styles = stylex.create({
  banner: {
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textMuted,
    fontSize: typography.sizeMd,
  },
});

const STATUS_LABELS: Record<SyncStatus, string> = {
  idle: "待機",
  connecting: "接続中",
  syncing: "同期中",
  ready: "同期済み",
  closed: "切断",
};

// §12 必須①: 初回同期後の切断・再同期はフォームを維持し、このバナーだけで知らせる。
// 保存(push)はアウトボックスに積まれ、接続回復後に自動送信される(engine の設計)。
// 再接続ボタンはヘッダー(route.tsx)にあるためここには置かない。
export function ConnectionBanner({ status }: { status: SyncStatus }) {
  if (status === "ready") {
    return null;
  }
  return (
    <div role="status" {...stylex.props(styles.banner)}>
      サーバーと再同期中です（状態: {STATUS_LABELS[status]}）。編集内容は維持され、保存は接続回復後に確定します。
    </div>
  );
}
```

(d) 3 ルートのゲートを置き換える。共通パターン(3 ファイルとも同じ変更):

import に追加:

```tsx
import { ConnectionBanner } from "../../../../../components/connection-banner";
import {
  useSyncHasSynced,
  useSyncStatus,
  useSyncTypes,
  useTenantSync,
} from "../../../../../lib/sync-context";
```

コンポーネント冒頭に `const hasSynced = useSyncHasSynced(sync);` を追加し、ゲートを:

```tsx
  // §12 必須①(2026-07-17 裁定): ゲートは初回同期の完了までに限る。以降の切断・再同期は
  // バナー表示のみでフォーム(未保存入力)を維持する。
  if (!hasSynced) {
    return <p {...stylex.props(styles.muted)}>同期中…（状態: {status}）</p>;
  }
```

に変更し、各ルートの return する JSX の先頭(`<h1>` の前)に `<ConnectionBanner status={status} />` を挿入する。対象:

- `index.tsx`(一覧): `if (status !== "ready")` → 上記。`<ConnectionBanner status={status} />` を `<h1>` の前に。
- `new.tsx`: 同様。
- `$recordId.tsx`(エディタ): 同様(`<ConnectionBanner status={status} />` は `<h1>` の直前)。

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/admin test -- sync records-flow shell publish-slots`
Expected: PASS(新規 2 追加、既存の「shows the syncing state until the bootstrap completes」は初回ゲート文言が同じため green のまま)

- [ ] **Step 6: admin 全テスト + typecheck / lint / format**

Run: `pnpm --filter @plyrs/admin test && pnpm --filter @plyrs/admin typecheck && pnpm lint && pnpm format:check`
Expected: 全 green・警告 0

- [ ] **Step 7: コミット**

```bash
git add apps/admin/src/lib/sync.ts apps/admin/src/lib/sync.test.ts apps/admin/src/lib/sync-context.tsx apps/admin/src/components/connection-banner.tsx "apps/admin/src/routes/t/\$tenantSlug/records/\$typeKey/index.tsx" "apps/admin/src/routes/t/\$tenantSlug/records/\$typeKey/new.tsx" "apps/admin/src/routes/t/\$tenantSlug/records/\$typeKey/\$recordId.tsx" apps/admin/src/records-flow.test.tsx
git commit -m "fix: keep record forms mounted across disconnects"
```

---

### Task 9: admin — RecordForm 改修(richtext 編集・dirty-only 保存・本文競合の二択)

**Files:**
- Modify: `apps/admin/src/components/record-form.tsx`(全面改修 — 下記の完全版に置き換える)
- Create: `apps/admin/src/components/conflict-dialog.tsx`
- Test: `apps/admin/src/components/record-form.test.tsx`(placeholder テスト更新 + 追記)

**Interfaces:**
- Consumes: Task 5/6 の `RichTextEditor` / `RichTextMentionItem`、Task 7 の `asRichTextValue` / `draftValueEquals` / `fromDraftValues(…, initialDraft)` / `richTextPlainText`、既存の `useRelationCandidates` / `SyncRejectedError` / `FieldConflict`。
- Produces: `RecordForm`(props は不変 — 呼び出し元ルートの変更は不要)、`syncConflictFields(cause): string[]`、`ConflictDialog({ conflicts, onKeepMine, onAdoptServer })`。挙動: 編集モードは dirty キーのみ書き戻し / conflict ack で二択ダイアログ / §8 の自己競合(手元最新 = 送信値)は静かに成功扱い。

**設計メモ(実装者向け):**
- `record` プロップは呼び出し元ルートで `rows.find(...)` から毎レンダー最新が渡る。TanStack Form の useForm はレンダーごとにオプションを更新するため、onSubmit クロージャの `record` は送信時点の最新。conflict の突き合わせ相手 = この最新 `record.input`(サーバーは他者の change を ack より先に配信する — ロードマップ §7)。
- 「サーバー版を採用」は conflict フィールドの form 値と dirty 基準(initialDraft)を最新値へ揃えるだけで push しない。「自分の版で上書き保存」は draft をそのまま再 submit — store には他者の版が確定済みなので `toChange` の baseFieldVersions が最新に進み、今度はクリーン上書きとして受理される。

- [ ] **Step 1: 失敗するテストを書く**

`apps/admin/src/components/record-form.test.tsx` を変更する。

(a) 既存テスト `renders inputs per field type with a read-only richtext placeholder` を以下に置き換え:

```tsx
  it("renders inputs per field type including the richtext editor", async () => {
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={null}
        submitLabel="保存"
        onSubmit={async () => {}}
      />,
    );
    expect(screen.getByRole("textbox", { name: "title" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "featured" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /category/ })).toBeInTheDocument();
    // richtext は Phase 7 で編集可能になった(プレースホルダーは廃止)
    expect(await screen.findByRole("textbox", { name: "body" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "body の書式" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /山田/ })).toBeInTheDocument();
  });
```

(b) 末尾に追記(import に `SyncRejectedError` を `@plyrs/sync-client` から、`rerender` 利用のため必要な調整を加える):

```tsx
const RECORD_ID = "018f2b6a-7a0a-7000-8000-000000000201";

function bodyEnvelope(text: string) {
  return {
    schemaVersion: 1,
    doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  };
}

function articleRecord(input: Record<string, unknown>, overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id: RECORD_ID,
    type: "article",
    input,
    fieldVersions: { title: 1, body: 1 },
    status: "draft",
    seq: 2,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

describe("RecordForm dirty-only 保存(§12 必須②)", () => {
  it("writes only user-touched keys and keeps others' concurrent edits", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {});
    const registry = buildRegistry();
    const initial = articleRecord({ title: "旧タイトル", body: bodyEnvelope("旧本文") });
    const view = render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={initial}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    const title = await screen.findByRole("textbox", { name: "title" });
    await user.clear(title);
    await user.type(title, "自分の新タイトル");
    // 他編集者の本文変更が WS で届いた(= record プロップが最新化された)
    const updated = articleRecord(
      { title: "旧タイトル", body: bodyEnvelope("他者の新本文") },
      { fieldVersions: { title: 1, body: 2 }, version: 2, seq: 3 },
    );
    view.rerender(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={updated}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole("button", { name: "保存" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const input = onSubmit.mock.calls[0]?.[0];
    expect(input?.["title"]).toBe("自分の新タイトル");
    // 触っていない body は他者の版が生き残る(巻き戻さない)
    expect(input?.["body"]).toEqual(bodyEnvelope("他者の新本文"));
  });

  it("submits an edited richtext envelope from the toolbar path", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {});
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={articleRecord({ title: "t", body: bodyEnvelope("本文") })}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await screen.findByRole("textbox", { name: "body" });
    await user.click(screen.getByRole("button", { name: "見出し1" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const body = onSubmit.mock.calls[0]?.[0]?.["body"] as {
      schemaVersion: number;
      doc: { content: Array<{ type: string }> };
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.doc.content[0]?.type).toBe("heading");
  });
});

describe("RecordForm 本文競合(裁定 3)", () => {
  function conflictError() {
    return new SyncRejectedError("conflict", "field conflicts: body", [
      { fieldKey: "body", baseVersion: 1, currentVersion: 2 },
    ]);
  }

  async function editBodyAndSave(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole("textbox", { name: "body" });
    await user.click(screen.getByRole("button", { name: "見出し1" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
  }

  it("adopts the server version: resets the editor without re-submitting", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {
      throw conflictError();
    });
    const registry = buildRegistry();
    const initial = articleRecord({ title: "t", body: bodyEnvelope("旧本文") });
    const view = render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={initial}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await editBodyAndSave(user);
    // rollback 後の record プロップ = 他者の版(broadcast が先に適用されている)
    const serverSide = articleRecord(
      { title: "t", body: bodyEnvelope("他者の本文") },
      { fieldVersions: { title: 1, body: 2 }, version: 2, seq: 3 },
    );
    view.rerender(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={serverSide}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const dialog = await screen.findByRole("alertdialog", { name: "本文の競合" });
    expect(dialog).toHaveTextContent("自分の版");
    expect(dialog).toHaveTextContent("他者の本文");
    await user.click(screen.getByRole("button", { name: "サーバー版を採用" }));
    await vi.waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "body" })).toHaveTextContent("他者の本文");
    expect(onSubmit).toHaveBeenCalledTimes(1); // 再送はしない
  });

  it("keeps mine: re-submits the same draft as a clean overwrite", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>();
    onSubmit.mockRejectedValueOnce(conflictError());
    onSubmit.mockResolvedValueOnce(undefined);
    const registry = buildRegistry();
    const initial = articleRecord({ title: "t", body: bodyEnvelope("旧本文") });
    const view = render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={initial}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await editBodyAndSave(user);
    view.rerender(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={articleRecord(
          { title: "t", body: bodyEnvelope("他者の本文") },
          { fieldVersions: { title: 1, body: 2 }, version: 2, seq: 3 },
        )}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "自分の版で上書き保存" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const secondBody = onSubmit.mock.calls[1]?.[0]?.["body"] as {
      doc: { content: Array<{ type: string }> };
    };
    expect(secondBody.doc.content[0]?.type).toBe("heading");
    await vi.waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("silently succeeds when the conflicting server value equals my submission (§8 自己競合ガード)", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {
      throw conflictError();
    });
    const registry = buildRegistry();
    const initial = articleRecord({ title: "t", body: bodyEnvelope("旧本文") });
    const view = render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={initial}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await editBodyAndSave(user);
    // ack 消失後の再送シナリオ: サーバーの現在値 = 自分が送った版
    const myBody = onSubmit.mock.calls[0]?.[0]?.["body"] as Record<string, unknown>;
    view.rerender(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={articleRecord(
          { title: "t", body: myBody },
          { fieldVersions: { title: 1, body: 2 }, version: 2, seq: 3 },
        )}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    await vi.waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
```

必要な import 追記: `import { SyncRejectedError } from "@plyrs/sync-client";`(既存 import 群に合流)。

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/admin test -- record-form`
Expected: FAIL(richtext がプレースホルダーのまま / alertdialog が存在しない)

- [ ] **Step 3: conflict-dialog.tsx を実装**

`apps/admin/src/components/conflict-dialog.tsx` を新規作成:

```tsx
import * as stylex from "@stylexjs/stylex";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";

const styles = stylex.create({
  dialog: {
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.danger,
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    fontSize: typography.sizeMd,
  },
  title: { fontWeight: 600 },
  fieldKey: { fontWeight: 600 },
  excerpt: { margin: 0, color: colors.textMuted },
  actions: { display: "flex", gap: spacing.sm },
});

export interface ConflictChoice {
  fieldKey: string;
  /** 自分の版の抜粋(プレーンテキスト) */
  mine: string;
  /** サーバー版(= 手元 store の最新 record)の抜粋 */
  theirs: string;
}

// design-spec §10.4 / 裁定 3(2026-07-17): 本文競合は自動マージせず二択で手動解決する。
// conflict ack にサーバー現在値は入らない(ロードマップ §7)ため、突き合わせ相手は手元
// store の最新 record — サーバーは他者の change を ack より先に配信するので一致する。
export function ConflictDialog({
  conflicts,
  onKeepMine,
  onAdoptServer,
}: {
  conflicts: ConflictChoice[];
  onKeepMine: () => void;
  onAdoptServer: () => void;
}) {
  return (
    <div role="alertdialog" aria-label="本文の競合" {...stylex.props(styles.dialog)}>
      <span {...stylex.props(styles.title)}>
        他の編集者が本文を変更しています。どちらの版を残すか選んでください。
      </span>
      {conflicts.map((conflict) => (
        <div key={conflict.fieldKey}>
          <span {...stylex.props(styles.fieldKey)}>{conflict.fieldKey}</span>
          <p {...stylex.props(styles.excerpt)}>自分の版: {conflict.mine}</p>
          <p {...stylex.props(styles.excerpt)}>サーバー版: {conflict.theirs}</p>
        </div>
      ))}
      <div {...stylex.props(styles.actions)}>
        <Button onPress={onKeepMine}>自分の版で上書き保存</Button>
        <Button variant="secondary" onPress={onAdoptServer}>
          サーバー版を採用
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: record-form.tsx を完全版に置き換える**

`apps/admin/src/components/record-form.tsx` 全体を以下に置き換える:

```tsx
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import type { ContentTypeDefinition, FieldDefinition } from "@plyrs/metamodel";
import type { FieldConflict, SyncRecord } from "@plyrs/sync-protocol";
import { SyncRejectedError } from "@plyrs/sync-client";
import type { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  RichTextEditor,
  Select,
  TextArea,
  TextField,
  type RichTextMentionItem,
} from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import {
  asRichTextValue,
  draftValueEquals,
  fromDraftValues,
  relationDraftKey,
  toDraftValues,
  type DraftValues,
} from "../lib/record-form-values";
import { richTextPlainText } from "../lib/richtext-text";
import { useRelationCandidates } from "../lib/use-collection";
import { ConflictDialog } from "./conflict-dialog";

const styles = stylex.create({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    maxWidth: "640px",
    fontFamily: typography.fontFamily,
  },
  banner: {
    padding: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.danger,
    color: colors.danger,
    fontSize: typography.sizeMd,
  },
  notice: {
    padding: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    color: colors.textMuted,
    fontSize: typography.sizeMd,
  },
  emptyHint: {
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: colors.border,
    color: colors.textMuted,
    fontSize: typography.sizeMd,
  },
  fieldLabel: { fontSize: typography.sizeSm, color: colors.textMuted },
  fieldError: { fontSize: typography.sizeSm, color: colors.danger },
  actions: { display: "flex", gap: spacing.sm },
});

// 一覧・relation picker 共用: 最初の text フィールド値をラベルに、無ければ id 先頭 8 桁
export function labelForRecord(types: ContentTypeDefinition[], record: SyncRecord): string {
  const definition = types.find((type) => type.key === record.type);
  const firstText = definition?.fields.find((field) => field.type === "text");
  if (firstText !== undefined) {
    const value = record.input[firstText.key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return record.id.slice(0, 8);
}

export function syncErrorMessage(cause: unknown): string {
  if (
    cause instanceof SyncRejectedError ||
    (cause instanceof Error && cause.name === "SyncRejectedError")
  ) {
    const code = (cause as { code?: string }).code ?? "unknown";
    return `保存できませんでした（${code}）: ${cause.message}`;
  }
  return "保存できませんでした。接続状態を確認して再試行してください。";
}

// conflict ack(ok:false, code:"conflict")から競合フィールド一覧を取り出す。
// それ以外のエラーは空配列(既存のエラーバナー経路へ)。
export function syncConflictFields(cause: unknown): string[] {
  const isRejection =
    cause instanceof SyncRejectedError ||
    (cause instanceof Error && cause.name === "SyncRejectedError");
  if (!isRejection || (cause as { code?: string }).code !== "conflict") {
    return [];
  }
  const conflicts = (cause as { conflicts?: FieldConflict[] }).conflicts ?? [];
  return conflicts.map((conflict) => conflict.fieldKey);
}

// 競合ダイアログの抜粋。richtext 以外が競合し得る将来拡張にも壊れないようフォールバックを持つ
function conflictExcerpt(value: unknown): string {
  const envelope = asRichTextValue(value);
  if (envelope !== undefined) {
    return richTextPlainText(envelope);
  }
  if (value === undefined) {
    return "（空）";
  }
  const text = JSON.stringify(value);
  return text.length <= 120 ? text : `${text.slice(0, 120)}…`;
}

export interface RecordFormProps {
  contentType: ContentTypeDefinition;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
  /** null = 新規作成 */
  record: SyncRecord | null;
  submitLabel: string;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}

interface PendingConflict {
  fieldKeys: string[];
  submittedInput: Record<string, unknown>;
  submittedDraft: DraftValues;
}

export function RecordForm({
  contentType,
  types,
  registry,
  record,
  submitLabel,
  onSubmit,
}: RecordFormProps) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  // §12 必須②: dirty 判定の基準。マウント時のスナップショットから始め、保存成功・
  // サーバー版採用のたびに「確定した姿」へ進める。
  const [initialDraft, setInitialDraft] = useState<DraftValues>(() =>
    toDraftValues(contentType, record?.input ?? {}),
  );

  // 本文中 record 参照(@)の候補: 同期済みの全型のコレクションを束ねて購読する
  // (relation picker と同じフックを全型キーで使い回す)。自分自身への参照は候補から外す。
  const mentionSource = useRelationCandidates(
    registry,
    types.map((type) => type.key),
  );
  const mentionCandidates: RichTextMentionItem[] = mentionSource
    .filter((candidate) => candidate.id !== record?.id)
    .map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      label: labelForRecord(types, candidate),
    }));

  const form = useForm({
    defaultValues: initialDraft,
    onSubmit: async ({ value }) => {
      setBanner(null);
      setNotice(null);
      // 編集(record あり)は dirty キーのみ書き戻す(§12 必須②)。新規作成は全量。
      const converted = fromDraftValues(
        contentType,
        value,
        record?.input ?? {},
        record !== null ? initialDraft : undefined,
      );
      if (!converted.ok) {
        setFieldErrors(converted.fieldErrors);
        const formLevel = converted.fieldErrors[""];
        if (formLevel !== undefined) {
          setBanner(formLevel);
        }
        return;
      }
      setFieldErrors({});
      try {
        await onSubmit(converted.input);
        // 保存成功: dirty 判定の基準を「今保存した姿」へ進める(次回以降の保存が
        // 直前保存分を再送して他者の後続変更を巻き戻すのを防ぐ)
        setInitialDraft(value);
      } catch (cause) {
        const conflictFields = syncConflictFields(cause);
        if (conflictFields.length > 0) {
          setConflict({
            fieldKeys: conflictFields,
            submittedInput: converted.input,
            submittedDraft: value,
          });
          return;
        }
        setBanner(syncErrorMessage(cause));
      }
    },
  });

  // §8 の自己競合ガード: conflict ack は「ack 消失後の再送が、適用済みの自分自身の変更と
  // 衝突した」だけのことがある。手元 store の最新 record と突き合わせ、全競合フィールドが
  // 自分の送信値と一致していれば実質成功として静かに閉じる。
  useEffect(() => {
    if (conflict === null) {
      return;
    }
    const latest = record?.input ?? {};
    const real = conflict.fieldKeys.filter(
      (key) => !draftValueEquals(latest[key], conflict.submittedInput[key]),
    );
    if (real.length === 0) {
      setInitialDraft(conflict.submittedDraft);
      setConflict(null);
    }
  }, [conflict, record]);

  const latestInput = record?.input ?? {};
  const realConflictKeys =
    conflict === null
      ? []
      : conflict.fieldKeys.filter(
          (key) => !draftValueEquals(latestInput[key], conflict.submittedInput[key]),
        );

  const adoptServer = () => {
    if (conflict === null) {
      return;
    }
    const serverDraft = toDraftValues(contentType, record?.input ?? {});
    setInitialDraft((previous) => {
      const next = { ...previous };
      for (const key of conflict.fieldKeys) {
        next[key] = serverDraft[key];
      }
      return next;
    });
    for (const key of conflict.fieldKeys) {
      form.setFieldValue(key, serverDraft[key]);
    }
    setConflict(null);
    setNotice("サーバー版を反映しました。他に未保存の変更が残っている場合は改めて保存してください。");
  };

  const keepMine = () => {
    setConflict(null);
    // draft は自分の版のまま。他者の変更は既に store に確定しているため、再送信の
    // baseFieldVersions は最新へ進み、今度はクリーンな上書き(手動裁定の LWW)として通る。
    void form.handleSubmit();
  };

  return (
    <form
      {...stylex.props(styles.form)}
      // isRequired を TextField に渡すと native required 属性が付き、ブラウザ(jsdom 含む)の
      // 制約検証が submit イベント自体を止めてしまい TanStack Form + zod の検証まで届かない。
      // 検証は変換層(record-form-values)に一本化するため native 検証を無効化する。
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {banner !== null && (
        <div role="alert" {...stylex.props(styles.banner)}>
          {banner}
        </div>
      )}
      {notice !== null && (
        <div role="status" {...stylex.props(styles.notice)}>
          {notice}
        </div>
      )}
      {conflict !== null && realConflictKeys.length > 0 && (
        <ConflictDialog
          conflicts={realConflictKeys.map((key) => ({
            fieldKey: key,
            mine: conflictExcerpt(conflict.submittedInput[key]),
            theirs: conflictExcerpt(latestInput[key]),
          }))}
          onKeepMine={keepMine}
          onAdoptServer={adoptServer}
        />
      )}
      {contentType.fields.map((field) => (
        // 動的キー: DraftValues は Record<string, unknown> のため form.Field の
        // DeepKeys<DraftValues> は string 全域に解決される。field.key は
        // ContentTypeDefinition から得た string なのでそのまま代入できる
        // (境界 cast 不要 — rpc-unwrap 様式の cast はここでは発生しない)。
        <form.Field key={field.key} name={field.key}>
          {(api) => (
            <FieldInput
              field={field}
              value={api.state.value}
              onChange={(next) => api.handleChange(next)}
              error={fieldErrors[field.key]}
              types={types}
              registry={registry}
              mentionCandidates={mentionCandidates}
            />
          )}
        </form.Field>
      ))}
      <div {...stylex.props(styles.actions)}>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  error,
  types,
  registry,
  mentionCandidates,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  error: string | undefined;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
  mentionCandidates: RichTextMentionItem[];
}) {
  switch (field.type) {
    case "text":
      return (
        <TextField
          label={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          isRequired={field.required ?? false}
          isInvalid={error !== undefined}
          errorMessage={error}
        />
      );
    case "number":
      return (
        <TextField
          label={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          inputMode="numeric"
          isInvalid={error !== undefined}
          errorMessage={error}
        />
      );
    case "datetime":
      return (
        <TextField
          label={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          // design-spec §5: 格納は UTC ISO8601('Z' 終端)。表示層の TZ 変換は将来課題。
          isInvalid={error !== undefined}
          errorMessage={error}
        />
      );
    case "boolean":
      return (
        <Checkbox isSelected={value === true} onChange={onChange}>
          {field.key}
        </Checkbox>
      );
    case "json":
      return (
        <TextArea
          label={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          isInvalid={error !== undefined}
          errorMessage={error}
        />
      );
    case "select": {
      const options = field.config.options.map((option) => ({
        value: option.value,
        label: option.label,
      }));
      if (field.config.multiple === true) {
        return (
          <CheckboxGroup
            label={field.key}
            options={options}
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={onChange}
            errorMessage={error}
          />
        );
      }
      return (
        <Select
          label={field.key}
          items={options}
          selectedValue={typeof value === "string" ? value : ""}
          onChange={onChange}
          placeholder="(未設定)"
          errorMessage={error}
        />
      );
    }
    case "richtext":
      return (
        <RichTextEditor
          label={field.key}
          value={asRichTextValue(value)}
          onChange={onChange}
          mentionCandidates={mentionCandidates}
          errorMessage={error}
        />
      );
    case "relation":
      return (
        <RelationPicker
          field={field}
          value={value}
          onChange={onChange}
          error={error}
          types={types}
          registry={registry}
        />
      );
  }
}

function RelationPicker({
  field,
  value,
  onChange,
  error,
  types,
  registry,
}: {
  field: Extract<FieldDefinition, { type: "relation" }>;
  value: unknown;
  onChange: (next: unknown) => void;
  error: string | undefined;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
}) {
  const candidates = useRelationCandidates(registry, field.config.allowedTypes);
  const options = candidates.map((candidate) => ({
    value: relationDraftKey({ type: candidate.type, id: candidate.id }),
    label: labelForRecord(types, candidate),
  }));
  if (candidates.length === 0) {
    return (
      <div>
        <span {...stylex.props(styles.fieldLabel)}>{field.key}</span>
        <div {...stylex.props(styles.emptyHint)}>
          参照できるレコードがありません（許可型: {field.config.allowedTypes.join(", ")}）
        </div>
        {error !== undefined && <span {...stylex.props(styles.fieldError)}>{error}</span>}
      </div>
    );
  }
  if (field.config.cardinality === "many") {
    return (
      <CheckboxGroup
        label={field.key}
        options={options}
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={onChange}
        errorMessage={error}
      />
    );
  }
  return (
    <Select
      label={field.key}
      items={options}
      selectedValue={typeof value === "string" ? value : ""}
      onChange={onChange}
      placeholder="(未設定)"
      errorMessage={error}
    />
  );
}
```

(差分の骨子: richtext ケースの置き換え / mentionCandidates の導入 / initialDraft + dirty-only submit / conflict 状態と ConflictDialog / notice バナー / styles.richtext → styles.emptyHint への改名。RelationPicker と他の FieldInput ケースは無変更。)

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/admin test -- record-form`
Expected: PASS(既存 4 + 新規 5、placeholder テストは更新済み)

- [ ] **Step 6: admin 全テスト + typecheck / lint / format**

Run: `pnpm --filter @plyrs/admin test && pnpm --filter @plyrs/admin typecheck && pnpm lint && pnpm format:check`
Expected: 全 green・警告 0(records-flow の既存テストは title のみの型なので richtext 追加の影響なし)

- [ ] **Step 7: コミット**

```bash
git add apps/admin/src/components/record-form.tsx apps/admin/src/components/record-form.test.tsx apps/admin/src/components/conflict-dialog.tsx
git commit -m "feat: richtext editing with conflict resolution ui"
```

---

### Task 10: admin — richtext ワイヤレベルのルートテスト(FakeSocket)

**Files:**
- Create: `apps/admin/src/richtext-flow.test.tsx`

**Interfaces:**
- Consumes: Task 8 のゲート変更、Task 9 の RecordForm。既存の `createAppContext` / `getRouter` / `FakeSocket` 様式(records-flow.test.tsx と同一)。
- Produces: ワイヤ(push の changedFields / baseFieldVersions / envelope)と競合解決 UI のエンドツーエンド検証。プロダクションコードの変更はなし — このタスクで FAIL が出たら Task 8/9 の実装バグとして扱い、テスト側を曲げないこと。

- [ ] **Step 1: テストを書く**

`apps/admin/src/richtext-flow.test.tsx` を新規作成:

```tsx
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";
import { FakeSocket } from "./test-utils/fake-socket";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = Mock<(init?: RequestInit) => Response>;

function stubFetch(routes: Record<string, Handler>): typeof fetch {
  return async (input, init) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : new URL(input.url).pathname;
    const handler = routes[path];
    if (handler === undefined) {
      throw new Error(`unexpected fetch: ${path}`);
    }
    return handler(init ?? undefined);
  };
}

const RECORD_1 = "018f2b6a-7a0a-7000-8000-000000000101";

function authedRoutes(): Record<string, Handler> {
  return {
    "/auth/tenants": vi.fn(() =>
      jsonResponse(200, { tenants: [{ id: "t1", slug: "blog", name: "Blog", role: "owner" }] }),
    ),
    "/auth/token": vi.fn(() => jsonResponse(200, { token: "jwt-abc", expiresIn: 900 })),
    "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
    [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
      jsonResponse(200, { published: false }),
    ),
  };
}

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "body", type: "richtext" },
  ],
};

function bodyEnvelope(text: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  };
}

function article(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id: RECORD_1,
    type: "article",
    input: { title: "旧タイトル", body: bodyEnvelope("旧本文") },
    fieldVersions: { title: 1, body: 1 },
    status: "draft",
    seq: 2,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

function socketHarness() {
  const sockets: FakeSocket[] = [];
  const connect = async () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  return {
    sockets,
    connect,
    // noUncheckedIndexedAccess: records-flow.test.tsx と同じ境界ガード方針(`!` は使わない)
    latest: (): FakeSocket => {
      const socket = sockets[sockets.length - 1];
      if (socket === undefined) {
        throw new Error("expected at least one connected socket");
      }
      return socket;
    },
  };
}

async function bootstrapped(socket: FakeSocket, records: SyncRecord[]) {
  await vi.waitFor(() => expect(socket.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }));
  socket.deliver({
    type: "welcome",
    protocolVersion: 1,
    contentTypes: [articleType],
    serverSeq: 10,
  });
  socket.deliver({ type: "sync", records, serverSeq: 10, complete: true });
}

function renderEditor(harness: ReturnType<typeof socketHarness>) {
  const router = getRouter({
    context: createAppContext(stubFetch(authedRoutes()), { connect: () => harness.connect }),
    history: createMemoryHistory({ initialEntries: [`/t/blog/records/article/${RECORD_1}`] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

interface PushedChange {
  changeId: string;
  recordId: string;
  input: Record<string, unknown>;
  changedFields: string[];
  baseFieldVersions: Record<string, number>;
  status?: string;
}

function pushes(socket: FakeSocket): PushedChange[] {
  return socket
    .parsed()
    .filter((message): message is { type: "push"; changes: PushedChange[] } => {
      return (message as { type: string }).type === "push";
    })
    .flatMap((message) => message.changes);
}

// 編集操作は 見出し1 トグル(ツールバー経由 = 実ユーザーと同一コードパス)で行う。
// jsdom は contenteditable へのタイピングを再現できないため(ui 側のテスト様式と同じ判断)。
async function toggleHeadingAndSave(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("textbox", { name: "body" });
  await user.click(screen.getByRole("button", { name: "見出し1" }));
  await user.click(screen.getByRole("button", { name: "保存" }));
}

describe("richtext のワイヤレベル編集(/t/$tenantSlug/records/$typeKey/$recordId)", () => {
  it("pushes only the body with its base version and the schemaVersion envelope", async () => {
    const harness = socketHarness();
    renderEditor(harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);

    const user = userEvent.setup();
    await toggleHeadingAndSave(user);

    await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(1));
    const change = pushes(harness.latest())[0];
    if (change === undefined) throw new Error("expected a pushed change");
    expect(change.changedFields).toEqual(["body"]);
    expect(change.baseFieldVersions).toEqual({ body: 1 });
    const body = change.input["body"] as {
      schemaVersion: number;
      doc: { content: Array<{ type: string }> };
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.doc.content[0]?.type).toBe("heading");
    expect(change.input["title"]).toBe("旧タイトル");

    // ack で確定 → エラーバナーなし
    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: {
        ok: true,
        record: article({
          input: { title: "旧タイトル", body: change.input["body"] },
          fieldVersions: { title: 1, body: 2 },
          seq: 11,
          version: 2,
        }),
      },
    });
    await vi.waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("does not roll back another editor's change on untouched fields (§12 必須②)", async () => {
    const harness = socketHarness();
    renderEditor(harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);

    const user = userEvent.setup();
    const title = await screen.findByRole("textbox", { name: "title" });
    await user.clear(title);
    await user.type(title, "自分の新タイトル");

    // 編集中に他者の本文変更が届く
    const theirs = bodyEnvelope("他者の新本文");
    harness.latest().deliver({
      type: "change",
      record: article({
        input: { title: "旧タイトル", body: theirs },
        fieldVersions: { title: 1, body: 2 },
        seq: 11,
        version: 2,
      }),
    });

    await user.click(screen.getByRole("button", { name: "保存" }));
    await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(1));
    const change = pushes(harness.latest())[0];
    if (change === undefined) throw new Error("expected a pushed change");
    // title だけが changedFields に載り、body は他者の版がそのまま運ばれる
    expect(change.changedFields).toEqual(["title"]);
    expect(change.baseFieldVersions).toEqual({ title: 1 });
    expect(change.input["body"]).toEqual(theirs);
  });
});

describe("本文競合の手動解決(裁定 3)", () => {
  async function conflictSetup(harness: ReturnType<typeof socketHarness>) {
    renderEditor(harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);
    const user = userEvent.setup();
    await toggleHeadingAndSave(user);
    await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(1));
    const change = pushes(harness.latest())[0];
    if (change === undefined) throw new Error("expected a pushed change");
    // 実サーバーの順序どおり: 他者の change を配信してから conflict ack を返す
    const theirs = article({
      input: { title: "旧タイトル", body: bodyEnvelope("他者の本文") },
      fieldVersions: { title: 1, body: 2 },
      seq: 11,
      version: 2,
    });
    harness.latest().deliver({ type: "change", record: theirs });
    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: {
        ok: false,
        code: "conflict",
        message: "field conflicts: body",
        conflicts: [{ fieldKey: "body", baseVersion: 1, currentVersion: 2 }],
      },
    });
    return { user, change };
  }

  it("adopting the server version resets the editor without a second push", async () => {
    const harness = socketHarness();
    const { user } = await conflictSetup(harness);
    const dialog = await screen.findByRole("alertdialog", { name: "本文の競合" });
    expect(dialog).toHaveTextContent("他者の本文");
    await user.click(screen.getByRole("button", { name: "サーバー版を採用" }));
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "body" })).toHaveTextContent("他者の本文");
    expect(pushes(harness.latest()).length).toBe(1); // 再送なし
  });

  it("keeping mine re-pushes with the advanced base version and wins", async () => {
    const harness = socketHarness();
    const { user, change } = await conflictSetup(harness);
    await screen.findByRole("alertdialog", { name: "本文の競合" });
    await user.click(screen.getByRole("button", { name: "自分の版で上書き保存" }));
    await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(2));
    const second = pushes(harness.latest())[1];
    if (second === undefined) throw new Error("expected a second push");
    expect(second.changedFields).toEqual(["body"]);
    // 他者の版が store に確定済みのため base は 2 へ進む = サーバーはクリーン上書きとして受理
    expect(second.baseFieldVersions).toEqual({ body: 2 });
    expect(second.input["body"]).toEqual(change.input["body"]);
    harness.latest().deliver({
      type: "ack",
      changeId: second.changeId,
      result: {
        ok: true,
        record: article({
          input: { title: "旧タイトル", body: second.input["body"] },
          fieldVersions: { title: 1, body: 3 },
          seq: 12,
          version: 3,
        }),
      },
    });
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("suppresses the dialog when the server value equals my submission (§8 自己競合ガード)", async () => {
    const harness = socketHarness();
    renderEditor(harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);
    const user = userEvent.setup();
    await toggleHeadingAndSave(user);
    await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(1));
    const change = pushes(harness.latest())[0];
    if (change === undefined) throw new Error("expected a pushed change");
    // ack 消失後の再送シナリオ: サーバーの現在値 = 自分が送った版(先行送信が適用済み)
    harness.latest().deliver({
      type: "change",
      record: article({
        input: { title: "旧タイトル", body: change.input["body"] },
        fieldVersions: { title: 1, body: 2 },
        seq: 11,
        version: 2,
      }),
    });
    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: {
        ok: false,
        code: "conflict",
        message: "field conflicts: body",
        conflicts: [{ fieldKey: "body", baseVersion: 1, currentVersion: 2 }],
      },
    });
    // ダイアログもエラーバナーも出ない(実質成功として静かに閉じる)
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テストが通ることを確認**

Run: `pnpm --filter @plyrs/admin test -- richtext-flow`
Expected: PASS(5 tests)。FAIL した場合はテストを曲げず Task 8/9 の実装を疑う(特に: conflict ack 後の tanstack-db ロールバックで record プロップが他者の版に更新されること / `toChange` の baseFieldVersions が store 最新から採られること)。

- [ ] **Step 3: admin 全テスト**

Run: `pnpm --filter @plyrs/admin test`
Expected: 全 green

- [ ] **Step 4: コミット**

```bash
git add apps/admin/src/richtext-flow.test.tsx
git commit -m "test: wire-level richtext editing and conflicts"
```

---

### Task 11: 全ゲート実測

**Files:** なし(検証のみ。修正が出た場合は該当タスクのファイル)

- [ ] **Step 1: 全パッケージのテスト**

Run: `cd <worktree> && CI=true pnpm -r test`
Expected: 全パッケージ green(metamodel 46+10 / db 13 / ui 22+10 / sync-protocol 15 / sync-client 62 / admin 85+15 前後 / api 284+3。件数は目安 — 実測値をレポートに貼る)

- [ ] **Step 2: typecheck**

Run: `pnpm -r typecheck`
Expected: エラー 0

- [ ] **Step 3: lint と format**

Run: `pnpm lint && pnpm format:check`
Expected: 警告 0・差分 0

- [ ] **Step 4: 修正が出たら該当タスクの様式で修正 → 再実行 → コミット**

```bash
git add -A && git commit -m "fix: address gate failures"
```

(ゲートが一発 green ならこのステップはスキップ。)

---

## 手動確認項目(最終報告で列挙する — 自動テストで担保できない面)

1. **タイピング・IME**: 実ブラウザでの日本語入力(変換中の composition)・キャレット移動・undo/redo。jsdom では原理的に検証不能。
2. **mention の実操作**: `@` からのドロップダウン表示位置・クリック確定・候補のライブ更新(別タブで record 追加 → 候補に現れる)。
3. **本文競合の実再現**: 2 タブで同一 record の本文を編集 → 後から保存した側に二択ダイアログが出て、両選択肢が期待どおり動くこと。
4. **切断バナー**: dev サーバー再起動でフォームが維持され、未保存入力が残ること。オフライン中の保存がアウトボックス経由で再接続後に届くこと。
5. **origin='body' の実機投影**: mention 入り本文を保存 → publish → 公開 API 応答に body 由来の関係が漏れて出ないこと(fields は origin='field' のみ)・逆引き(使用箇所)の将来 UI の下地として relations に行があること。
6. **リンク**: openOnClick 無効の確認、リンク済みテキストの再編集 UX。
7. 6a/6b からの手動確認バックログ(ロードマップ §11・§12)は依然未実施。

## 実行メモ(コントローラ向け)

- **worktree**: EnterWorktree → 直後に `git reset --hard main` → `CI=true pnpm install --frozen-lockfile`(sandbox 無効で実行してよい — pnpm store がサンドボックス外)。
- **Task 4 の install**: manifest 編集後にコントローラが sandbox 無効で `pnpm install --no-frozen-lockfile`。lockfile はそのタスクのコミットに含める。
- **新規ルートなし** → routeTree.gen.ts の再生成は本フェーズでは不要。ルートファイルの中身の変更(Task 8)は再生成を要求しない。
- **並列レーン**: (Task 1→2→3)、(Task 4→5→6)、Task 8 は互いに独立。Task 7 は Task 1 の後なら (4→5→6) と並行可。Task 9 は 5・6・7 の後、Task 10 は 8・9 の後。
- **サブエージェント必須ルール**(全ディスパッチ文に毎回明記):
  - 全コマンドを `cd <worktree の絶対パス> && ...` で実行。コミット前に `git rev-parse --abbrev-ref HEAD` の出力をレポートに貼る。
  - テスト・コマンドの実出力を貼る(要約・改変は重大違反)。
  - bare `git stash` 禁止 / `@ts-expect-error`・`any` 禁止 / node_modules へのシンボリックリンク禁止 / sandbox 制限は回避せず停止・報告。
- **レビュー**: タスクごとに中位モデルのレビュアー(計画自体への異議も拾わせる)。修正後は再レビュー。最終ブランチレビューは最上位モデル。
- **マージ**: 全ゲート green + 最終レビュー通過後、main へローカル fast-forward(sandbox 無効化はマージ工程のみ可)→ ロードマップ §3 の行を「完了」へ更新し「Phase 7 完了時の申し送り」を追記 → ワークツリーとブランチを削除。

## Self-Review(計画作成時に実施済み)

- **Spec coverage**: スコープ 6 項目すべてにタスクがある — Tiptap エディタ(4,5,6)/ AST エンベロープ(1)/ 抽出純関数 + DO 接続(2,3)/ エディタ UI・ツールバー(5,6)/ 本文競合 UI(9,10)/ §12 必須①(8)・②(7,9)。裁定 6 件はすべて「裁定事項」節に固定し、各タスクが参照している。
- **Placeholder scan**: TBD・「あとで実装」なし。Task 1 の型アノテーション contingency と Task 5/6 のフォーカス fallback は「特定の失敗が観測されたときの決定済み代替手段」であり未決事項ではない。
- **型整合**: `RichTextValue`(ui)は `RichTextEnvelope`(metamodel)の構造的スーパータイプ(doc: unknown ⊇ doc: RichTextNode)— RecordForm は `asRichTextValue` で狭めてから渡す。`RECORD_MENTION_NODE_NAME` = `RECORD_MENTION_NODE_TYPE` = `"recordMention"`、attrs は 3 箇所(record-mention.ts / body-relations.ts / テスト)とも `{recordType, recordId, label}`。`fromDraftValues` の第 4 引数は Task 7 定義・Task 9 使用で一致。`getHasSynced` は Task 8 内で定義・使用が閉じる。
- **§12 必須②の完全性**: dirty-only の書き戻し(Task 7)+ 送信時の最新 baseInput(既存挙動)+ 保存成功時の基準前進(Task 9)で、「触っていないフィールドの巻き戻し」と「連続保存での再送」の両方を塞いだ。ワイヤ検証は Task 10 テスト 2 本目。




