import { describe, expect, it } from "vitest";
import type { RichTextEnvelope } from "@plyrs/metamodel";
import { canonicalJson, ensureTopLevelBlockIds, hashBlock } from "./block-ids";
import { fixtures } from "./fixtures";

function v1(doc: RichTextEnvelope["doc"]): RichTextEnvelope {
  return { schemaVersion: 1, doc };
}

const para = (text: string, attrs?: Record<string, string>) => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content: [{ type: "text", text }],
});

describe("v1 を読むときの最上位ブロック ID の決定的な導出", () => {
  it("同じ record を何度読んでも同じ ID が出る(JSON を作り直しても同じ)", () => {
    const make = () => v1({ type: "doc", content: [para("a"), para("b"), para("a")] });
    const first = ensureTopLevelBlockIds(make());
    const second = ensureTopLevelBlockIds(JSON.parse(JSON.stringify(make())) as RichTextEnvelope);
    const ids = (r: typeof first) => r.envelope.doc.content!.map((b) => b.attrs?.["id"]);
    expect(ids(first)).toEqual(ids(second));
    expect(first.derived).toBe(3);
    // 同じ内容の段落(1 番目と 3 番目)は位置が違うので別 ID
    expect(ids(first)[0]).not.toBe(ids(first)[2]);
    expect(new Set(ids(first)).size).toBe(3);
  });

  it("attrs のキー順が違っても同じ ID(正規化してハッシュする)", () => {
    const a = { type: "heading", attrs: { level: 2, textAlign: null }, content: [{ type: "text", text: "h" }] };
    const b = { type: "heading", attrs: { textAlign: null, level: 2 }, content: [{ type: "text", text: "h" }] };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(hashBlock(0, a)).toBe(hashBlock(0, b));
  });

  it("内容が変わると ID が変わる(= 読み書きの間の変更は baseFieldVersions の不一致でも捕まる)", () => {
    const before = ensureTopLevelBlockIds(v1({ type: "doc", content: [para("a")] }));
    const after = ensureTopLevelBlockIds(v1({ type: "doc", content: [para("a!")] }));
    expect(before.envelope.doc.content![0]!.attrs?.["id"]).not.toBe(
      after.envelope.doc.content![0]!.attrs?.["id"],
    );
  });

  it("前にブロックが挿入されると後続の導出 ID も変わる(位置を含めるため。永続化で安定する)", () => {
    const before = ensureTopLevelBlockIds(v1({ type: "doc", content: [para("b")] }));
    const after = ensureTopLevelBlockIds(v1({ type: "doc", content: [para("a"), para("b")] }));
    expect(after.envelope.doc.content![1]!.attrs?.["id"]).not.toBe(
      before.envelope.doc.content![0]!.attrs?.["id"],
    );
  });

  it("保存された ID があればそれを優先し、無いブロックだけ導出する", () => {
    const result = ensureTopLevelBlockIds(
      v1({ type: "doc", content: [para("saved", { id: "pm-saved-1" }), para("unsaved")] }),
    );
    expect(result.derived).toBe(1);
    expect(result.envelope.doc.content![0]!.attrs?.["id"]).toBe("pm-saved-1");
    expect(result.envelope.doc.content![1]!.attrs?.["id"]).toMatch(/^v1-[0-9a-f]{24}$/);
  });

  it("schemaVersion 2 で全ブロックに ID があれば何も導出しない(冪等)", () => {
    const saved: RichTextEnvelope = {
      schemaVersion: 2,
      doc: { type: "doc", content: [para("a", { id: "x1" }), para("b", { id: "x2" })] },
    };
    const result = ensureTopLevelBlockIds(saved);
    expect(result.derived).toBe(0);
    expect(result.envelope).toEqual(saved);
  });

  it("重複した保存 ID(コピー&ペースト由来)は 2 つ目以降を導出で置き換える", () => {
    const result = ensureTopLevelBlockIds(
      v1({ type: "doc", content: [para("a", { id: "dup" }), para("b", { id: "dup" })] }),
    );
    const ids = result.envelope.doc.content!.map((b) => b.attrs?.["id"]);
    expect(ids[0]).toBe("dup");
    expect(ids[1]).not.toBe("dup");
    expect(result.derived).toBe(1);
  });

  it("全フィクスチャで最上位ブロックの ID が一意になる", () => {
    for (const fixture of fixtures) {
      const result = ensureTopLevelBlockIds(v1(fixture.doc as RichTextEnvelope["doc"]));
      const ids = result.envelope.doc.content!.map((b) => b.attrs?.["id"]);
      expect(new Set(ids).size, fixture.name).toBe(ids.length);
    }
  });
});
