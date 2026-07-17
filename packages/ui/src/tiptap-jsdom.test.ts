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
