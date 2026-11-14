import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import {
  ASSET_IMAGE_NODE_TYPE,
  BLOCK_ID_ATTR,
  BLOCK_ID_NODE_TYPES,
  RECORD_MENTION_NODE_TYPE,
  RICH_TEXT_SCHEMA_VERSION as METAMODEL_RICH_TEXT_SCHEMA_VERSION,
  extractBodyRelations,
  type ContentTypeDefinition,
} from "@plyrs/metamodel";
import {
  ASSET_IMAGE_NODE_NAME,
  BLOCK_ID_ATTR_NAME,
  RECORD_MENTION_NODE_NAME,
  RICH_TEXT_BLOCK_ID_NODE_TYPES,
  RICH_TEXT_HEADING_LEVELS,
  RICH_TEXT_SCHEMA_VERSION,
  RichTextEditor,
  type RichTextEditorProps,
} from "@plyrs/ui";
import { HEADING_LEVELS, richTextSchema } from "@plyrs/richtext";

// このファイルは .ts(.tsx ではない)なので JSX 構文は使わず createElement を直接呼ぶ
// (拡張子は brief / セッション規約の git add パスに合わせて固定 — .tsx への改名はしない)。

// @tiptap/core は apps/admin の直接依存ではない(@plyrs/ui だけが持つ)。この admin 側の
// ファイルから "@tiptap/core" を直接 import すると、apps/admin の node_modules 起点の
// 解決になり型定義が見つからない(pnpm の隔離構成 — 実行時は動くが tsc は落ちる)。
// onEditorReady の引数型から Editor 型を導出すれば、実際の解決は @plyrs/ui 側の
// ファイル(そちらは @tiptap/core を直接依存として持つ)起点になり問題が起きない。
type Editor = Parameters<NonNullable<RichTextEditorProps["onEditorReady"]>>[0];

// エディタ(ui)が書くノードと、DO 側抽出(metamodel)が読む契約を固定する。
// どちらかを変えるときは両方を同時に変え、このテストで一致を確かめること。
describe("record mention / asset image contract", () => {
  it("ui node names match the metamodel extraction targets", () => {
    expect(RECORD_MENTION_NODE_NAME).toBe(RECORD_MENTION_NODE_TYPE);
    expect(ASSET_IMAGE_NODE_NAME).toBe(ASSET_IMAGE_NODE_TYPE);
  });

  // M2-1(決定 44): エディタが書く版とブロック ID の属性名は metamodel の導出(正本)と一致する
  it("ui schema version and block id attribute match the metamodel", () => {
    expect(RICH_TEXT_SCHEMA_VERSION).toBe(METAMODEL_RICH_TEXT_SCHEMA_VERSION);
    expect(BLOCK_ID_ATTR_NAME).toBe(BLOCK_ID_ATTR);
  });

  // M2-2: エディタの見出しレベルは Worker 側(Markdown 変換・スキーマ検証)の語彙と一致する
  it("ui heading levels match the richtext vocabulary", () => {
    expect(RICH_TEXT_HEADING_LEVELS).toEqual([...HEADING_LEVELS]);
  });

  // M5a-6: 書き込み時の構造の検査(Worker 側のスキーマ ∪ ブロック ID)が、エディタの作る本文を拒否しない。
  // ノード種・マーク種の名前と、種類ごとの属性の集合が一致することを固定する
  it("editor schema matches the worker schema plus block ids (node / mark attrs)", async () => {
    expect([...RICH_TEXT_BLOCK_ID_NODE_TYPES].sort()).toEqual([...BLOCK_ID_NODE_TYPES].sort());
    let captured: Editor | null = null;
    render(
      createElement(RichTextEditor, {
        label: "body",
        value: undefined,
        onChange: () => {},
        onEditorReady: (editor: Editor) => {
          captured = editor;
        },
      }),
    );
    await vi.waitFor(() => expect(captured).not.toBeNull());
    if (captured === null) {
      throw new Error("editor not ready");
    }
    const editorSchema = (captured as Editor).schema;
    const worker = richTextSchema();
    const blockIdTypes = new Set<string>(BLOCK_ID_NODE_TYPES);
    const attrsOf = (spec: { attrs?: Record<string, unknown> | null }) =>
      Object.keys(spec.attrs ?? {}).sort();
    const editorNodes = Object.fromEntries(
      Object.entries(editorSchema.nodes).map(([name, type]) => [name, attrsOf(type.spec)]),
    );
    const workerNodes = Object.fromEntries(
      Object.entries(worker.nodes).map(([name, type]) => [
        name,
        [...attrsOf(type.spec), ...(blockIdTypes.has(name) ? [BLOCK_ID_ATTR] : [])].sort(),
      ]),
    );
    expect(editorNodes).toEqual(workerNodes);
    const marksOf = (schema: typeof worker) =>
      Object.fromEntries(
        Object.entries(schema.marks).map(([name, type]) => [name, attrsOf(type.spec)]),
      );
    expect(marksOf(editorSchema as unknown as typeof worker)).toEqual(marksOf(worker));
  });

  // ロードマップ §13 推奨: ノード名だけでなく attrs キーまで(ui 産の実 doc を
  // extractBodyRelations に通して)固定するクロスパッケージ契約テスト。
  it("editor-produced docs feed extractBodyRelations with both node kinds", async () => {
    const AUTHOR_ID = "018f2b6a-7a0a-7000-8000-0000000000a1";
    const ASSET_ID = "018f2b6a-7a0a-7000-8000-0000000000a2";
    let captured: Editor | null = null;
    render(
      createElement(RichTextEditor, {
        label: "body",
        value: undefined,
        onChange: () => {},
        onEditorReady: (editor: Editor) => {
          captured = editor;
        },
      }),
    );
    await vi.waitFor(() => expect(captured).not.toBeNull());
    if (captured === null) {
      throw new Error("editor not ready");
    }
    const editor: Editor = captured;
    editor
      .chain()
      .insertContent([
        {
          type: "paragraph",
          content: [
            {
              type: RECORD_MENTION_NODE_NAME,
              attrs: { recordType: "author", recordId: AUTHOR_ID, label: "山田" },
            },
          ],
        },
        {
          type: ASSET_IMAGE_NODE_NAME,
          attrs: { recordType: "asset", recordId: ASSET_ID, label: "hero.png" },
        },
      ])
      .run();

    const contentType: ContentTypeDefinition = {
      id: "018f2b6a-7a0a-7000-8000-0000000000a3",
      key: "article",
      name: "記事",
      source: "user",
      version: 1,
      fields: [{ key: "body", type: "richtext" }],
    };
    const writes = extractBodyRelations(contentType, {
      body: { schemaVersion: 1, doc: editor.getJSON() },
    });
    expect(writes).toEqual([
      {
        fieldKey: "body",
        refs: [
          { type: "author", id: AUTHOR_ID },
          { type: "asset", id: ASSET_ID },
        ],
      },
    ]);
  });
});
