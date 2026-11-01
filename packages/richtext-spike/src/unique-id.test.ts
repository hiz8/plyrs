// @vitest-environment jsdom
// @tiptap/extension-unique-id 3.31.4 の挙動確認(M0-2 の確認項目):
//  1. 既存文書(ID なし = v1 相当)を開くと、最上位ブロックだけに ID が付くか(types を絞る)
//  2. コピー&ペースト(transformPasted)で ID の重複が解消されるか
//  3. generateID を差し替えて、決定的な ID 導出(block-ids.ts)と同じ規則にできるか
import { Editor } from "@tiptap/core";
import UniqueID from "@tiptap/extension-unique-id";
import { Fragment, Slice } from "@tiptap/pm/model";
import { afterEach, describe, expect, it } from "vitest";
import { plyrsExtensions } from "./extensions";

// jsdom は Range の測定 API を実装しない(packages/ui/vitest.setup.ts と同じシム)
const zeroRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getBoundingClientRect = () => zeroRect;
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Element.prototype.scrollIntoView = () => {};

// 最上位ブロックになりうるノード種(doc 直下に置けるもの)。listItem や text には付けない
const TOP_LEVEL_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "assetImage",
];

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

// Tiptap 3 は "create" イベント(onCreate = 初期 ID 付与)を setTimeout で遅らせるため、1 tick 待つ
async function createEditor(content: object, generateID?: () => string) {
  let counter = 0;
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: [
      ...plyrsExtensions(),
      UniqueID.configure({
        types: TOP_LEVEL_TYPES,
        generateID: generateID ?? (() => `gen-${++counter}`),
      }),
    ],
    content,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return editor;
}

const v1Doc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "a" }] },
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "li" }] }] }],
    },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "h" }] },
  ],
};

describe("@tiptap/extension-unique-id", () => {
  it("ID の無い文書を開くと、types に挙げたノードにだけ ID が付く(入れ子の paragraph にも付く)", async () => {
    const e = await createEditor(v1Doc);
    const json = e.getJSON();
    const top = json.content!;
    // 所見 1: StarterKit 3.x は trailingNode を含むため、末尾に空段落が 1 つ足される(gen-5)。
    // 保存形式としては「末尾の空段落」が常に増えうることを意味する(ui の既存エディタも同じ)
    expect(top.map((n) => n.attrs?.["id"])).toEqual(["gen-1", "gen-2", "gen-4", "gen-5"]);
    expect(top[3]).toEqual({ type: "paragraph", attrs: { id: "gen-5" } });
    // 所見 2: types は「ノード種」で指定するので、bulletList > listItem > paragraph の paragraph にも
    // ID が付く(gen-3)。「最上位ブロックだけ」に限るには、保存時に入れ子の id を落とすか、
    // 入れ子にも ID を持たせる(ブロック操作の粒度を細かくする)かを M2-1 で選ぶ
    const nestedParagraph = (top[1] as { content: { content: { attrs?: Record<string, unknown> }[] }[] }).content[0]!.content[0]!;
    expect(nestedParagraph.attrs?.["id"]).toBe("gen-3");
  });

  it("ペースト(transformPasted)で持ち込まれた ID は捨てられ、新しい ID が振られる", async () => {
    const e = await createEditor(v1Doc);
    const before = e.getJSON().content!.map((n) => n.attrs?.["id"]);
    // 1 番目の段落をコピーして末尾にペーストする(ブラウザの paste イベントを模す:
    // 拡張は paste の DOM イベントで transformPasted フラグを立ててから transformPasted を適用する)
    const view = e.view;
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    // handleDOMEvents.paste を直接呼ぶ(jsdom の ClipboardEvent は dataTransfer を持てない)
    const pasteProp = view.someProp("handleDOMEvents", (handlers) => handlers["paste"]);
    pasteProp?.(view, pasteEvent as ClipboardEvent);
    const firstBlock = view.state.doc.child(0);
    const slice = new Slice(Fragment.from(firstBlock), 0, 0);
    // 拡張の transformPasted は (slice, view, event, plain) の 4 引数(prosemirror-view の型は 3 引数)
    type TransformPasted = (slice: Slice, view: typeof e.view, event: ClipboardEvent, plain: boolean) => Slice;
    const transformed =
      view.someProp("transformPasted", (f) =>
        (f as unknown as TransformPasted)(slice, view, pasteEvent as ClipboardEvent, false),
      ) ?? slice;
    const end = view.state.doc.content.size;
    view.dispatch(view.state.tr.replace(end, end, transformed));
    const after = e.getJSON().content!.map((n) => n.attrs?.["id"]);
    expect(after.length).toBe(before.length + 1);
    expect(after.at(-1)).not.toBe(before[0]);
    expect(new Set(after).size).toBe(after.length);
  });

  it("所見 3: insertContent(プログラムからの挿入)で同じ ID を持つブロックを足すと重複が残る", async () => {
    const e = await createEditor(v1Doc);
    const first = e.getJSON().content![0]!;
    e.commands.insertContentAt(e.state.doc.content.size, { ...first });
    const ids = e.getJSON().content!.map((n) => n.attrs?.["id"]);
    // 拡張の重複解消は paste / drop(transformPasted)と「分割で元位置が消えた」場合に限られる。
    // MCP の record_update がブロックを ID 付きで送る経路では、サーバー側(DO)で重複を検出して
    // 振り直す必要がある(block-ids.ts の ensureTopLevelBlockIds が担う)
    expect(ids.filter((id) => id === first.attrs?.["id"]).length).toBe(2);
  });

  it("generateID は差し替えられる(決定的な導出規則と同じものを渡せる)", async () => {
    let n = 0;
    const e = await createEditor(v1Doc, () => `det-${n++}`);
    expect(e.getJSON().content![0]!.attrs?.["id"]).toBe("det-0");
  });
});
