import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import {
  ASSET_IMAGE_NODE_TYPE,
  RECORD_MENTION_NODE_TYPE,
  extractBodyRelations,
  type ContentTypeDefinition,
} from "@plyrs/metamodel";
import {
  ASSET_IMAGE_NODE_NAME,
  RECORD_MENTION_NODE_NAME,
  RichTextEditor,
  type RichTextEditorProps,
} from "@plyrs/ui";

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
