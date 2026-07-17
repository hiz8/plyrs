import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

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
