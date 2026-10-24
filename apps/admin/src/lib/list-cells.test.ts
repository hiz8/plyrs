import type { ContentTypeDefinition, FieldDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it } from "vitest";
import { cellText, listColumnsOf, rowCells } from "./list-cells";

const ID_A = "018f2b6a-7a0a-7000-8000-0000000000a1";
const ID_B = "018f2b6a-7a0a-7000-8000-0000000000a2";

const colorOptions = [
  { value: "r", label: "赤" },
  { value: "b", label: "青" },
];

const fields: FieldDefinition[] = [
  { key: "title", type: "text", required: true },
  { key: "subtitle", type: "text", label: "副題" },
  { key: "code", type: "text" },
  { key: "slug", type: "text", label: "URL", config: { unique: true } },
  { key: "views", type: "number" },
  { key: "featured", type: "boolean", label: "注目" },
  { key: "starts_at", type: "datetime", label: "開始" },
  { key: "color", type: "select", config: { options: colorOptions } },
  { key: "tags", type: "select", config: { multiple: true, options: colorOptions } },
  { key: "authors", type: "relation", config: { allowedTypes: ["author"], cardinality: "many" } },
  { key: "body", type: "richtext" },
  { key: "extra", type: "json" },
];
const byKey = (key: string): FieldDefinition => {
  const f = fields.find((x) => x.key === key);
  if (f === undefined) throw new Error(key);
  return f;
};

const type = (listColumns: string[]): ContentTypeDefinition => ({
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields,
  listColumns,
});

const record = (input: Record<string, unknown>): SyncRecord => ({
  id: ID_A,
  type: "article",
  input,
  fieldVersions: {},
  status: "draft",
  seq: 1,
  version: 1,
  deletedAt: null,
  updatedAt: "2026-07-17T00:00:00Z",
  updatedBy: "u1",
});

describe("list-cells", () => {
  it("listColumnsOf は listColumns の順で label を付け、型に無い key を落とし、4 件目以降を切る", () => {
    const cols = listColumnsOf(type(["subtitle", "nope", "code", "views", "featured"]));
    expect(cols.map(({ key, label, mono }) => ({ key, label, mono }))).toEqual([
      { key: "subtitle", label: "副題", mono: false },
      { key: "code", label: "code", mono: false },
      { key: "views", label: "views", mono: false },
    ]);
    expect(listColumnsOf({ ...type([]), listColumns: undefined })).toEqual([]);
  });

  it("listColumnsOf は slug(key が slug で unique の text)だけ mono にする", () => {
    expect(listColumnsOf(type(["slug", "subtitle"])).map((c) => [c.key, c.mono])).toEqual([
      ["slug", true],
      ["subtitle", false],
    ]);
  });

  it("cellText は種類ごとに整える(text / number / boolean / datetime / select 単一・複数 / relation 件数 / richtext・json は —)", () => {
    expect(cellText(byKey("subtitle"), "abc")).toBe("abc");
    expect(cellText(byKey("code"), "my-slug")).toBe("my-slug");
    expect(cellText(byKey("views"), 12345)).toBe((12345).toLocaleString("ja-JP"));
    expect(cellText(byKey("featured"), true)).toBe("はい");
    expect(cellText(byKey("featured"), false)).toBe("いいえ");
    expect(cellText(byKey("starts_at"), "2026-07-17T00:00:00Z")).not.toBe("—");
    expect(cellText(byKey("color"), "r")).toBe("赤");
    expect(cellText(byKey("tags"), ["r", "b"])).toBe("赤、青");
    expect(cellText(byKey("tags"), ["r", "zz"])).toBe("赤、zz");
    expect(cellText(byKey("authors"), [{ type: "author", id: ID_A }])).toBe("1 件");
    expect(cellText(byKey("authors"), [])).toBe("—");
    expect(cellText(byKey("body"), { type: "doc" })).toBe("—");
    expect(cellText(byKey("extra"), { a: 1 })).toBe("—");
  });

  it("型に無い key は列にせず、不適合な値は — にする", () => {
    const t = type(["views", "starts_at", "color", "authors", "ghost"]);
    const cols = listColumnsOf(t);
    expect(cols.map((c) => c.key)).toEqual(["views", "starts_at", "color"]);
    expect(rowCells(t, record({ views: "many", starts_at: "abc", color: "zz" }), cols)).toEqual([
      "—",
      "—",
      "—",
    ]);
    const t2 = type(["authors"]);
    expect(
      rowCells(t2, record({ authors: [{ type: "author", id: ID_B }] }), listColumnsOf(t2)),
    ).toEqual(["1 件"]);
    expect(rowCells(t2, record({ authors: "bad" }), listColumnsOf(t2))).toEqual(["—"]);
  });
});
