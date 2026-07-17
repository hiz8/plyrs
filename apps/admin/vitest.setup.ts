import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest.config.ts は test.globals を有効化していないため、@testing-library/react の
// auto-cleanup（afterEach が global にある前提）が発火しない。明示的に登録する。
// 未クリーンアップだと複数 it() が render() する auth-flow.test.tsx で <html> が二重マウントされる。
afterEach(() => {
  cleanup();
});

// 14 ファイル並列実行時の CPU 競合で findBy*（既定 1 秒）が確率的に切れる。
// アサート内容ではなく待ち時間だけの問題なので、非同期ユーティリティの上限を広げる。
configure({ asyncUtilTimeout: 5_000 });

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
