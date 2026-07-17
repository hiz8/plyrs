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
