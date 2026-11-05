import { describe, expect, it } from "vitest";
import { BLOCK_ID_ATTR, type RichTextEnvelope } from "@plyrs/metamodel";
import { getSchema, type JSONContent } from "@tiptap/core";
import { workerExtensions } from "./extensions";
import { fixtures } from "./fixtures";
import {
  checkRichText,
  checkRichTextVocabulary,
  markdownToRichText,
  richTextToMarkdown,
} from "./markdown";
import { normalize } from "./normalize";

// M2-2(決定 46): Tiptap の全ノード種・全マーク種 19 件が Markdown との往復で可逆であることを固定する
// (M0-2 試作の fidelity.test.ts の (c) 列)。比較の前に ProseMirror のスキーマを通し、attrs の既定値を
// 埋め、ブロック ID と null の attrs は差分と見ない。

const schema = getSchema(workerExtensions());
function canon(doc: JSONContent): JSONContent {
  return normalize(schema.nodeFromJSON(doc).toJSON() as JSONContent);
}

function envelope(doc: JSONContent): RichTextEnvelope {
  return { schemaVersion: 2, doc: doc as RichTextEnvelope["doc"] };
}

describe("Markdown ⇄ AST の往復忠実度", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const markdown = richTextToMarkdown(envelope(fixture.doc));
      const back = markdownToRichText(markdown);
      expect(back.ok, markdown).toBe(true);
      if (!back.ok) return;
      expect(canon(back.envelope.doc as JSONContent)).toEqual(canon(fixture.doc));
    });
  }

  it("独自ノードの Markdown 文法(確定): record 参照の shortcode と plyrs://asset の画像", () => {
    const mention = fixtures.find((f) => f.name === "recordMention");
    const image = fixtures.find((f) => f.name === "assetImage");
    if (mention === undefined || image === undefined) throw new Error("fixture missing");
    expect(richTextToMarkdown(envelope(mention.doc))).toBe(
      '著者は [@ recordType="author" recordId="018f2b6a-7a0a-7000-8000-000000000001" label="山田"] です',
    );
    expect(richTextToMarkdown(envelope(image.doc))).toBe(
      "図:\n\n![hero.png](plyrs://asset/018f2b6a-7a0a-7000-8000-000000000002)\n\n以上",
    );
  });
});

describe("markdownToRichText", () => {
  it("版 2 で最上位ブロックに ID が付いた envelope を返す", () => {
    const result = markdownToRichText("# 見出し\n\n本文");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.schemaVersion).toBe(2);
    const blocks = result.envelope.doc.content ?? [];
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.attrs?.[BLOCK_ID_ATTR]).toMatch(/^v1-/);
    }
    expect(checkRichText(result.envelope)).toEqual({ ok: true });
  });

  it("空文字・空白だけは空段落 1 つに正規化する", () => {
    for (const input of ["", "  \n\n"]) {
      const result = markdownToRichText(input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.envelope.doc.content?.map((b) => b.type)).toEqual(["paragraph"]);
    }
  });

  it("見出し 4〜6 は 3 に丸める", () => {
    const result = markdownToRichText("#### 深い\n\n###### もっと深い");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.doc.content?.map((b) => b.attrs?.["level"])).toEqual([3, 3]);
  });

  it("GFM テーブルは unsupported_markdown(table)", () => {
    const result = markdownToRichText("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(result).toMatchObject({
      ok: false,
      code: "unsupported_markdown",
      unsupported: ["table"],
    });
  });

  it("行頭・行末の | を省いた GFM テーブルも unsupported_markdown(table)で、黙って消えない", () => {
    for (const table of ["| a | b\n| --- | ---\n| 1 | 2", "a | b\n--|--\n1 | 2"]) {
      const result = markdownToRichText(`前\n\n${table}\n\n後`);
      expect(result, table).toMatchObject({
        ok: false,
        code: "unsupported_markdown",
        unsupported: ["table"],
      });
    }
  });

  it("コードブロック内の | a | や - [ ] と、通常のリンクの [x](https://…) は拒否しない", () => {
    const result = markdownToRichText(
      "```\n| a | b |\n| --- | --- |\n- [ ] todo\n```\n\n[x](https://example.com/) と `| c |`",
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.doc.content?.map((n) => n.type)).toEqual(["codeBlock", "paragraph"]);
  });

  it("引用やリストの中の外部画像・タスクリストも検出する", () => {
    expect(markdownToRichText("> ![x](https://example.com/x.png)")).toMatchObject({
      ok: false,
      unsupported: ["external_image"],
    });
    expect(markdownToRichText("- 親\n  - [ ] 子")).toMatchObject({
      ok: false,
      unsupported: ["task_list"],
    });
  });

  it("タスクリストは unsupported_markdown(task_list)", () => {
    const result = markdownToRichText("- [ ] todo\n- [x] done");
    expect(result).toMatchObject({ ok: false, unsupported: ["task_list"] });
  });

  it("外部 URL の画像は unsupported_markdown(external_image)で、アセットの導線を案内する", () => {
    const result = markdownToRichText("![alt](https://example.com/x.png)");
    expect(result).toMatchObject({ ok: false, unsupported: ["external_image"] });
    if (result.ok) return;
    expect(result.message).toContain("plyrs://asset/");
  });

  it("生の HTML は文字列として段落に入る(無害)", () => {
    const result = markdownToRichText('<div class="x">html</div>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.doc.content?.[0]?.type).toBe("paragraph");
  });

  it("入れ子の引用と start=3 の番号リストは正しく変換される", () => {
    const quote = markdownToRichText("> 外\n>\n> > 内");
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    const outer = quote.envelope.doc.content?.[0];
    expect(outer?.type).toBe("blockquote");
    expect(outer?.content?.some((n) => n.type === "blockquote")).toBe(true);

    const list = markdownToRichText("3. 三\n4. 四");
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.envelope.doc.content?.[0]).toMatchObject({
      type: "orderedList",
      attrs: { start: 3 },
    });
  });
});

describe("checkRichTextVocabulary(M5a-6)", () => {
  const doc = (content: unknown[]) => ({
    schemaVersion: 2,
    doc: { type: "doc", content } as never,
  });

  it("空の doc とブロック ID 付きの段落は通る", () => {
    expect(checkRichTextVocabulary(doc([]))).toEqual({ ok: true });
    expect(
      checkRichTextVocabulary(doc([{ type: "paragraph", attrs: { id: "p" }, content: [] }])),
    ).toEqual({ ok: true });
  });

  it("語彙に無いノード、余分な属性、ブロック ID の付かないノードの id は拒否する", () => {
    expect(checkRichTextVocabulary(doc([{ type: "iframe" }])).ok).toBe(false);
    expect(
      checkRichTextVocabulary(doc([{ type: "paragraph", attrs: { src: "javascript:x" } }])).ok,
    ).toBe(false);
    expect(
      checkRichTextVocabulary(
        doc([{ type: "bulletList", content: [{ type: "listItem", attrs: { id: "x" } }] }]),
      ).ok,
    ).toBe(false);
  });
});
