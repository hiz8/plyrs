import { ensureTopLevelBlockIds, type RichTextEnvelope } from "@plyrs/metamodel";
import { describe, expect, it } from "vitest";
import { compareVersions } from "../src/do/history";
import { resolveRichTextInputs } from "../src/ops/richtext-input";
import { articleType } from "./fixtures";

// M4-1a(design-spec 16.10): richtext フィールドの Markdown 入力とブロック操作

const type = {
  fields: [...articleType().fields, { key: "meta", type: "json" as const }],
};

function envelopeOf(markdownLike: { type: string; text: string }[]): RichTextEnvelope {
  return ensureTopLevelBlockIds({
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: markdownLike.map((b) => ({
        type: b.type,
        ...(b.type === "heading" ? { attrs: { level: 2 } } : {}),
        content: [{ type: "text", text: b.text }],
      })),
    },
  }).envelope;
}

function blocksOf(value: unknown) {
  return ((value as RichTextEnvelope).doc.content ?? []).map((b) => ({
    id: b.attrs?.["id"],
    type: b.type,
    text: b.content?.[0]?.text,
  }));
}

function resolved(result: ReturnType<typeof resolveRichTextInputs>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.input;
}

const current = () => ({
  body: envelopeOf([
    { type: "paragraph", text: "一" },
    { type: "paragraph", text: "二" },
    { type: "paragraph", text: "三" },
  ]),
});

describe("resolveRichTextInputs", () => {
  it("Markdown 文字列をエンベロープにする(見出しと段落、最上位ブロックに ID)", () => {
    const input = resolved(resolveRichTextInputs(type, { body: "## 見出し\n\n本文" }, null));
    const blocks = blocksOf(input["body"]);
    expect(blocks.map((b) => [b.type, b.text])).toEqual([
      ["heading", "見出し"],
      ["paragraph", "本文"],
    ]);
    expect(blocks.every((b) => typeof b.id === "string")).toBe(true);
  });

  it("replace は指したブロックだけを変え、ID を保つ", () => {
    const before = blocksOf(current().body);
    const input = resolved(
      resolveRichTextInputs(
        type,
        { body: { blocks: [{ op: "replace", id: before[1]!.id, markdown: "差し替え" }] } },
        current(),
      ),
    );
    const after = blocksOf(input["body"]);
    expect(after.map((b) => b.text)).toEqual(["一", "差し替え", "三"]);
    expect(after.map((b) => b.id)).toEqual(before.map((b) => b.id));
  });

  it("insert の after: null は先頭、after: ID はその後ろ。delete で消える", () => {
    const before = blocksOf(current().body);
    const input = resolved(
      resolveRichTextInputs(
        type,
        {
          body: {
            blocks: [
              { op: "insert", after: null, markdown: "零" },
              { op: "insert", after: before[0]!.id, markdown: "一の次" },
              { op: "delete", id: before[2]!.id },
            ],
          },
        },
        current(),
      ),
    );
    const after = blocksOf(input["body"]);
    expect(after.map((b) => b.text)).toEqual(["零", "一", "一の次", "二"]);
    expect(new Set(after.map((b) => b.id)).size).toBe(4);
  });

  it("無い ID は block_not_found", () => {
    const result = resolveRichTextInputs(
      type,
      { body: { blocks: [{ op: "delete", id: "nope" }] } },
      current(),
    );
    expect(result).toMatchObject({ ok: false, code: "block_not_found", details: { id: "nope" } });
  });

  it("表は unsupported_markdown(kind: table)", () => {
    const result = resolveRichTextInputs(type, { body: "| a | b |\n|---|---|\n| 1 | 2 |" }, null);
    expect(result).toMatchObject({
      ok: false,
      code: "unsupported_markdown",
      details: { field: "body", kind: "table" },
    });
  });

  it("外部 URL の画像は unsupported_markdown で、asset_import_url を案内する", () => {
    const result = resolveRichTextInputs(type, { body: "![x](https://example.com/a.png)" }, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_markdown");
    expect(result.message).toContain("asset_import_url");
  });

  it("json フィールドの文字列やエンベロープはそのまま。record_create で blocks は invalid_input", () => {
    const envelope = current().body;
    const input = resolved(
      resolveRichTextInputs(type, { meta: "# そのまま", body: envelope }, null),
    );
    expect(input["meta"]).toBe("# そのまま");
    expect(input["body"]).toBe(envelope);
    expect(
      resolveRichTextInputs(type, { body: { blocks: [{ op: "delete", id: "x" }] } }, null),
    ).toMatchObject({ ok: false, code: "invalid_input" });
  });
});

describe("compareVersions(空配列)", () => {
  it("空配列と未設定は差分にしない(record_compare と履歴の changedFields)", () => {
    expect(compareVersions({ related: [] }, {})).toEqual([]);
    expect(compareVersions({}, { related: [] })).toEqual([]);
    expect(compareVersions({ related: [] }, { related: ["x"] })).toHaveLength(1);
  });
});
