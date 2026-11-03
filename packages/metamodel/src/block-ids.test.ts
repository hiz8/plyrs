import { describe, expect, it } from "vitest";
import {
  BLOCK_ID_ATTR,
  canonicalJson,
  ensureRecordBlockIds,
  ensureTopLevelBlockIds,
  hashBlock,
  RICH_TEXT_SCHEMA_VERSION,
} from "./block-ids";
import type { ContentTypeDefinition } from "./content-type";
import type { RichTextEnvelope } from "./record-schema";

function v1(doc: RichTextEnvelope["doc"]): RichTextEnvelope {
  return { schemaVersion: 1, doc };
}

const para = (text: string, attrs?: Record<string, string>) => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content: [{ type: "text", text }],
});

const ids = (envelope: RichTextEnvelope) =>
  (envelope.doc.content ?? []).map((block) => block.attrs?.[BLOCK_ID_ATTR]);

const make = () => v1({ type: "doc", content: [para("a"), para("b"), para("a")] });

describe("ensureTopLevelBlockIds(決定 44: v1 を読むときの決定的な ID 導出)", () => {
  it("同じ record を何度読んでも同じ ID が出る(JSON を作り直しても同じ)", () => {
    const first = ensureTopLevelBlockIds(make());
    const second = ensureTopLevelBlockIds(JSON.parse(JSON.stringify(make())) as RichTextEnvelope);
    expect(ids(first.envelope)).toEqual(ids(second.envelope));
    expect(first.changed).toBe(true);
    expect(first.envelope.schemaVersion).toBe(RICH_TEXT_SCHEMA_VERSION);
    // 同じ内容の段落(1 番目と 3 番目)は位置が違うので別 ID
    expect(new Set(ids(first.envelope)).size).toBe(3);
    for (const id of ids(first.envelope)) {
      expect(id).toMatch(/^v1-[0-9a-f]{24}$/);
    }
  });

  it("attrs のキー順が違っても同じ ID(正規化してハッシュする)", () => {
    const a = {
      type: "heading",
      attrs: { level: 2, textAlign: null },
      content: [{ type: "text", text: "h" }],
    };
    const b = {
      type: "heading",
      attrs: { textAlign: null, level: 2 },
      content: [{ type: "text", text: "h" }],
    };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(hashBlock(0, a)).toBe(hashBlock(0, b));
  });

  it("内容が変わると ID が変わる", () => {
    const before = ensureTopLevelBlockIds(v1({ type: "doc", content: [para("a")] }));
    const after = ensureTopLevelBlockIds(v1({ type: "doc", content: [para("a!")] }));
    expect(ids(before.envelope)[0]).not.toBe(ids(after.envelope)[0]);
  });

  it("前にブロックが挿入されると後続の導出 ID も変わる(位置を含めるため。永続化で安定する)", () => {
    const before = ensureTopLevelBlockIds(v1({ type: "doc", content: [para("b")] }));
    const after = ensureTopLevelBlockIds(v1({ type: "doc", content: [para("a"), para("b")] }));
    expect(ids(after.envelope)[1]).not.toBe(ids(before.envelope)[0]);
  });

  it("保存された ID があればそれを優先し、無いブロックだけ導出する", () => {
    const result = ensureTopLevelBlockIds(
      v1({ type: "doc", content: [para("saved", { id: "pm-saved-1" }), para("unsaved")] }),
    );
    expect(result.changed).toBe(true);
    expect(ids(result.envelope)[0]).toBe("pm-saved-1");
    expect(ids(result.envelope)[1]).toMatch(/^v1-[0-9a-f]{24}$/);
  });

  it("schemaVersion 2 で全ブロックに ID があれば changed: false で同じ参照を返す(冪等)", () => {
    const saved: RichTextEnvelope = {
      schemaVersion: 2,
      doc: { type: "doc", content: [para("a", { id: "x1" }), para("b", { id: "x2" })] },
    };
    const result = ensureTopLevelBlockIds(saved);
    expect(result.changed).toBe(false);
    expect(result.envelope).toBe(saved);
  });

  it("全ブロックに ID があっても schemaVersion 1 なら 2 に上げる", () => {
    const result = ensureTopLevelBlockIds(v1({ type: "doc", content: [para("a", { id: "x1" })] }));
    expect(result.changed).toBe(true);
    expect(result.envelope.schemaVersion).toBe(2);
    expect(ids(result.envelope)).toEqual(["x1"]);
  });

  it("重複した保存 ID(コピー&ペースト由来)は 2 つ目以降を導出で置き換える", () => {
    const result = ensureTopLevelBlockIds(
      v1({ type: "doc", content: [para("a", { id: "dup" }), para("b", { id: "dup" })] }),
    );
    expect(ids(result.envelope)[0]).toBe("dup");
    expect(ids(result.envelope)[1]).toMatch(/^v1-[0-9a-f]{24}$/);
  });

  it("導出 ID が後ろの保存済み ID と重なっても奪わず、接尾辞を付ける(先頭に同じ内容を入れた場合)", () => {
    const taken = hashBlock(0, para("a"));
    const result = ensureTopLevelBlockIds({
      schemaVersion: 2,
      doc: { type: "doc", content: [para("a"), para("a", { id: taken })] },
    });
    expect(ids(result.envelope)).toEqual([`${taken}-2`, taken]);
  });

  it("入れ子のノードには触らない(契約は最上位ブロックだけ)", () => {
    const list = {
      type: "bulletList",
      content: [{ type: "listItem", content: [para("item")] }],
    };
    const result = ensureTopLevelBlockIds(v1({ type: "doc", content: [list] }));
    const stored = result.envelope.doc.content?.[0];
    expect(stored?.attrs?.[BLOCK_ID_ATTR]).toMatch(/^v1-/);
    expect(stored?.content?.[0]?.content?.[0]?.attrs).toBeUndefined();
  });
});

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "body", type: "richtext" },
    { key: "extra", type: "json" },
  ],
};

describe("ensureRecordBlockIds", () => {
  it("richtext フィールドだけに ID を付け、他のフィールドは同じ値のまま", () => {
    const body = v1({ type: "doc", content: [para("a")] });
    const extra = { schemaVersion: 1, doc: { type: "doc", content: [para("json")] } };
    const result = ensureRecordBlockIds(articleType, { title: "t", body, extra });
    expect(result.changed).toBe(true);
    expect(result.data["title"]).toBe("t");
    expect(result.data["extra"]).toBe(extra);
    expect((result.data["body"] as RichTextEnvelope).schemaVersion).toBe(2);
  });

  it("エンベロープとして解釈できない値や未設定は触らず changed: false", () => {
    const data = { title: "t", body: "not an envelope" };
    const result = ensureRecordBlockIds(articleType, data);
    expect(result.changed).toBe(false);
    expect(result.data).toBe(data);
  });

  it("既に版 2 で ID が揃っていれば同じ参照を返す", () => {
    const data = {
      title: "t",
      body: { schemaVersion: 2, doc: { type: "doc", content: [para("a", { id: "x" })] } },
    };
    const result = ensureRecordBlockIds(articleType, data);
    expect(result.changed).toBe(false);
    expect(result.data).toBe(data);
  });
});
