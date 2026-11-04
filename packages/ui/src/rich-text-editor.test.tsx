import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RICH_TEXT_SCHEMA_VERSION, RichTextEditor, type RichTextValue } from "./rich-text-editor";
import type { RichTextMentionItem } from "./record-mention";

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

  it("isAllowedLink が拒否する URL のリンクは付けない(Tiptap の既定の検査と両方を通す)", async () => {
    let editor: Editor | null = null;
    render(
      <RichTextEditor
        label="body"
        value={docWith("リンク先")}
        onChange={() => {}}
        onEditorReady={(e) => (editor = e)}
        isAllowedLink={(url) => url.startsWith("https:")}
      />,
    );
    await screen.findByRole("textbox", { name: "body" });
    if (editor === null) throw new Error("editor not ready");
    const current = editor as Editor;
    current.commands.setTextSelection({ from: 1, to: 4 });
    current.commands.setLink({ href: "ftp://example.com/a" });
    expect(JSON.stringify(current.getJSON())).not.toContain("ftp://example.com/a");
    current.commands.setLink({ href: "javascript:alert(1)" });
    expect(JSON.stringify(current.getJSON())).not.toContain("javascript:");
    current.commands.setLink({ href: "https://example.com" });
    expect(JSON.stringify(current.getJSON())).toContain("https://example.com");
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

  it("round-trips a mention through HTML serialize/parse (paste path)", async () => {
    let editor: Editor | null = null;
    render(<MentionHarness onReady={(e) => (editor = e)} />);
    await screen.findByRole("textbox", { name: "body" });
    if (editor === null) throw new Error("editor not ready");
    (editor as Editor).chain().focus().insertContent("@").run();
    await screen.findByRole("listbox");
    await userEvent.setup().click(screen.getByRole("option", { name: /山田/ }));
    const html = (editor as Editor).getHTML();
    (editor as Editor).commands.setContent(html, { emitUpdate: false });
    const json = JSON.stringify((editor as Editor).getJSON());
    expect(json).toContain('"recordMention"');
    expect(json).toContain("018f2b6a-7a0a-7000-8000-000000000021");
    expect(json).toContain('"recordType":"author"');
  });
});

describe("画像挿入 (Phase 8 決定 5)", () => {
  it("always registers the assetImage node so docs containing it open safely", async () => {
    let captured: Editor | null = null;
    render(
      <RichTextEditor
        label="本文"
        value={{
          schemaVersion: 1,
          doc: {
            type: "doc",
            content: [
              {
                type: "assetImage",
                attrs: {
                  recordType: "asset",
                  recordId: "018f2b6a-7a0a-7000-8000-0000000000ab",
                  label: "hero.png",
                },
              },
            ],
          },
        }}
        onChange={() => {}}
        onEditorReady={(editor) => {
          captured = editor;
        }}
      />,
    );
    await vi.waitFor(() => expect(captured).not.toBeNull());
    // TS narrows `captured` to `never` past the closure-reassignment + await boundary
    // (同ファイル既存テストと同じ null ガード + cast の慣習)。
    if (captured === null) throw new Error("editor not ready");
    const doc = (captured as Editor).getJSON();
    expect(doc?.content?.[0]?.type).toBe("assetImage");
  });

  it("shows the 画像 toolbar button only with onRequestAssetImage and inserts via callback", async () => {
    const onChange = vi.fn();
    let insertFn: ((item: { id: string; label: string }) => void) | null = null;
    const { rerender } = render(
      <RichTextEditor label="本文" value={undefined} onChange={onChange} />,
    );
    expect(screen.queryByRole("button", { name: "画像" })).not.toBeInTheDocument();

    rerender(
      <RichTextEditor
        label="本文"
        value={undefined}
        onChange={onChange}
        onRequestAssetImage={(insert) => {
          insertFn = insert;
        }}
      />,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "画像" }));
    expect(insertFn).not.toBeNull();
    // 同上: 閉包での再代入越しの読み出しは never に narrow されるため null ガード + cast
    if (insertFn === null) throw new Error("insertFn not captured");
    (insertFn as (item: { id: string; label: string }) => void)({
      id: "018f2b6a-7a0a-7000-8000-0000000000ab",
      label: "hero.png",
    });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    const last = onChange.mock.lastCall?.[0] as {
      doc: { content: Array<{ type: string; attrs?: Record<string, unknown> }> };
    };
    const node = last.doc.content.find((child) => child.type === "assetImage");
    expect(node?.attrs?.["recordId"]).toBe("018f2b6a-7a0a-7000-8000-0000000000ab");
    expect(node?.attrs?.["label"]).toBe("hero.png");
  });
});

describe("RichTextEditor ツールバーの見た目", () => {
  it("ツールバーのボタンはアイコンのみで、名前は従来どおり", () => {
    render(<RichTextEditor label="本文" value={undefined} onChange={() => {}} />);
    const bold = screen.getByRole("button", { name: "太字" });
    expect(bold).toHaveTextContent("");
    expect(bold.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("separator").length).toBeGreaterThan(0);
  });
});

it("isReadOnly はツールバーを出さず編集できない", async () => {
  let editor: Editor | undefined;
  render(
    <RichTextEditor
      label="本文"
      value={undefined}
      onChange={() => {}}
      isReadOnly
      onRequestAssetImage={() => {}}
      onEditorReady={(e) => {
        editor = e;
      }}
    />,
  );
  await vi.waitFor(() => expect(editor).toBeDefined());
  expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "画像" })).not.toBeInTheDocument();
  expect(editor?.isEditable).toBe(false);
  const surface = screen.getByRole("textbox", { name: "本文" });
  expect(surface).toHaveAttribute("aria-readonly", "true");
  expect(surface).toHaveAttribute("tabindex", "0");
  expect(surface.style.paddingLeft).toBe("0px");
  expect(surface.style.paddingRight).toBe("0px");
});

// M2-1(決定 44): 最上位ブロックの安定 ID。エディタへ渡す前に ID 導出を通す契約なので、
// 版 2 の文書を開いただけで onChange が走らない(UniqueID の onCreate による入れ子ノードへの
// 付与は履歴にも onChange にも乗せない)。新しいブロックには UniqueID が ID を振る。
describe("RichTextEditor block ids", () => {
  const v2WithList: RichTextValue = {
    schemaVersion: 2,
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "先頭" }] },
        {
          type: "bulletList",
          attrs: { id: "l1" },
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "項目" }] }],
            },
          ],
        },
      ],
    },
  };

  it("does not emit onChange when opening a v2 document whose nested nodes lack ids", async () => {
    const onChange = vi.fn();
    render(<Harness initial={v2WithList} onChange={onChange} />);
    await screen.findByRole("textbox", { name: "body" });
    // UniqueID の onCreate は setTimeout で遅延するので 1 tick 待つ
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("re-rendering with the same value does not replace the document (nested ids differ only inside)", async () => {
    let editor: Editor | undefined;
    // 親(admin の record-form)は描画ごとに導出を通した新しい参照を渡しうるので、同じ内容の別参照で再描画する
    const same = () => structuredClone(v2WithList);
    const { rerender } = render(
      <RichTextEditor
        label="body"
        value={same()}
        onChange={() => {}}
        onEditorReady={(e) => (editor = e)}
      />,
    );
    await screen.findByRole("textbox", { name: "body" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // UniqueID は入れ子(listItem 内の段落)にも ID を振るので getJSON は value と一致しない。
    // それでも最上位以外の差だけなら setContent で文書を置き換えない(カーソルと undo が飛ぶ)
    // editor.commands は取得ごとに作られるので spy できない。setContent は state.doc を置き換えるので参照で見る
    const before = editor!.state.doc;
    expect(JSON.stringify(editor!.getJSON())).not.toBe(JSON.stringify(v2WithList.doc));
    rerender(
      <RichTextEditor
        label="body"
        value={same()}
        onChange={() => {}}
        onEditorReady={(e) => (editor = e)}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(editor!.state.doc).toBe(before);
  });

  it("assigns an id to a newly created top-level block and keeps stored ids", async () => {
    const onChange = vi.fn();
    let editor: Editor | undefined;
    render(<Harness initial={v2WithList} onChange={onChange} onReady={(e) => (editor = e)} />);
    await screen.findByRole("textbox", { name: "body" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    editor!
      .chain()
      .focus("end")
      .insertContentAt(editor!.state.doc.content.size, {
        type: "paragraph",
        content: [{ type: "text", text: "新規" }],
      })
      .run();
    const value = lastValue(onChange);
    expect(value.schemaVersion).toBe(RICH_TEXT_SCHEMA_VERSION);
    const blocks = (value.doc as { content: { type: string; attrs?: Record<string, unknown> }[] })
      .content;
    expect(blocks[0]?.attrs?.["id"]).toBe("p1");
    expect(blocks[1]?.attrs?.["id"]).toBe("l1");
    const added = blocks.find((b) => JSON.stringify(b).includes("新規"));
    const addedId = added?.attrs?.["id"];
    expect(typeof addedId).toBe("string");
    expect(addedId).not.toBe("");
  });

  // G4: 最上位の最後が段落でないと TrailingNode が空の段落を足す。編集の保存にそれを含めない
  type Block = { type: string; attrs?: Record<string, unknown>; content?: unknown[] };
  const blocksOf = (value: RichTextValue) => (value.doc as { content: Block[] }).content;

  it("TrailingNode が足した末尾の空の段落は、ほかのブロックを編集しても保存値に入らない", async () => {
    const onChange = vi.fn();
    let editor: Editor | undefined;
    render(<Harness initial={v2WithList} onChange={onChange} onReady={(e) => (editor = e)} />);
    await screen.findByRole("textbox", { name: "body" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // エディタの中には末尾の空の段落がある(TrailingNode)
    expect(editor!.state.doc.lastChild?.type.name).toBe("paragraph");
    editor!.chain().setTextSelection(3).insertContent("追記").run();
    const blocks = blocksOf(lastValue(onChange));
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "bulletList"]);
    expect(JSON.stringify(blocks[0])).toContain("追記");
    // 保存値との比較で文書を置き換えない(末尾の空の段落はエディタに残る)
    expect(editor!.state.doc.lastChild?.type.name).toBe("paragraph");
  });

  it("末尾の段落に書き込めば、その段落は保存値に入る", async () => {
    const onChange = vi.fn();
    let editor: Editor | undefined;
    render(<Harness initial={v2WithList} onChange={onChange} onReady={(e) => (editor = e)} />);
    await screen.findByRole("textbox", { name: "body" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    editor!.chain().focus("end").insertContent("末尾").run();
    const blocks = blocksOf(lastValue(onChange));
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "bulletList", "paragraph"]);
    expect(JSON.stringify(blocks[2])).toContain("末尾");
  });

  it("段落のあとに利用者が足した空の段落は外さない(TrailingNode が足すものではない)", async () => {
    const onChange = vi.fn();
    let editor: Editor | undefined;
    render(
      <Harness initial={docWith("一行目")} onChange={onChange} onReady={(e) => (editor = e)} />,
    );
    await screen.findByRole("textbox", { name: "body" });
    editor!.chain().focus("end").splitBlock().run();
    const blocks = blocksOf(lastValue(onChange));
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  });
});
