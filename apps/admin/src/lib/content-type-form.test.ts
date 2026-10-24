import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import type { ContentTypeSummary } from "./admin-api";
import {
  autoFill,
  availableKinds,
  buildDefinition,
  changeKind,
  countEmpty,
  countFilled,
  effectiveTitleField,
  emptyFieldDraft,
  emptyTypeDraft,
  fieldChange,
  fieldDraftErrors,
  fieldTags,
  hasSlugField,
  isTypeDraftDirty,
  isTypeDraftEmpty,
  kindOf,
  suggestKey,
  summaryToDefinition,
  toFieldDraft,
  toTypeDraft,
  validateFieldKey,
  validateTypeKey,
  keyErrorMessage,
  type FieldDraft,
  type TypeDraft,
} from "./content-type-form";
import { CONTENT_TYPE_LABELS, FIELD_PANEL_LABELS } from "./labels";

const uuid = "018f2b6a-7a0a-7000-8000-000000000001";

function summary(overrides: Partial<ContentTypeSummary> = {}): ContentTypeSummary {
  return {
    id: uuid,
    key: "article",
    name: "記事",
    fields: [],
    source: "user",
    pluginId: null,
    createdAt: "2026-07-17T00:00:00Z",
    updatedAt: "2026-07-17T00:00:00Z",
    version: 1,
    description: null,
    titleField: null,
    listColumns: null,
    menuOrder: null,
    ...overrides,
  };
}

function record(key: string, value: unknown, deletedAt: string | null = null): SyncRecord {
  return {
    id: crypto.randomUUID(),
    type: "article",
    input: { [key]: value },
    fieldVersions: {},
    status: "draft",
    seq: 1,
    version: 1,
    deletedAt,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u",
  };
}

const fields: FieldDefinition[] = [
  { key: "title", type: "text", required: true, config: { maxLength: 200, unique: true } },
  { key: "slug", type: "text", config: { unique: true, indexed: true } },
  { key: "count", type: "number", config: { integer: true, indexed: true } },
  { key: "featured", type: "boolean", config: { indexed: true } },
  { key: "published_at", type: "datetime", config: { indexed: true } },
  { key: "meta", type: "json" },
  {
    key: "tags",
    type: "select",
    config: {
      options: [
        { value: "tech", label: "Tech" },
        { value: "life", label: "Life" },
      ],
      multiple: true,
      indexed: true,
    },
  },
  { key: "body", type: "richtext", label: "本文", description: "説明です" },
  {
    key: "eyecatch",
    type: "relation",
    config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
  },
  {
    key: "authors",
    type: "relation",
    required: true,
    config: { allowedTypes: ["author", "team"], cardinality: "many", ordered: true },
  },
];

describe("kindOf", () => {
  it("slug / asset / reference を設定から見分ける", () => {
    expect(kindOf({ key: "slug", type: "text", config: { unique: true } })).toBe("slug");
    expect(kindOf({ key: "slug", type: "text" })).toBe("text");
    expect(
      kindOf({
        key: "eyecatch",
        type: "relation",
        config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
      }),
    ).toBe("asset");
    expect(
      kindOf({
        key: "authors",
        type: "relation",
        config: { allowedTypes: ["author"], cardinality: "many" },
      }),
    ).toBe("reference");
  });
});

describe("toTypeDraft / buildDefinition round-trip", () => {
  it("全種類の round-trip で定義が保たれる", () => {
    const draft = toTypeDraft(summary({ fields }));
    expect(draft.fields.map((f) => f.kind)).toStrictEqual([
      "text",
      "slug",
      "number",
      "boolean",
      "datetime",
      "json",
      "select",
      "richtext",
      "asset",
      "reference",
    ]);
    const result = buildDefinition({ id: uuid, version: 1, draft });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.fields).toStrictEqual(fields);
    expect(result.definition).toMatchObject({ id: uuid, key: "article", source: "user" });
  });

  it("asset は snapshotEmbed value を常に付け、slug は unique true と key slug を固定する", () => {
    const asset = emptyFieldDraft("asset", "photo", "写真");
    const slug = emptyFieldDraft("slug", "slug", "スラッグ");
    expect(slug.key).toBe("slug");
    expect(slug.unique).toBe(true);
    expect(asset.allowedTypes).toStrictEqual(["asset"]);
    const draft: TypeDraft = {
      ...emptyTypeDraft(),
      name: "T",
      key: "t",
      fields: [asset, { ...slug, unique: false }],
    };
    const result = buildDefinition({ id: uuid, version: 1, draft });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.fields[0]).toStrictEqual({
      key: "photo",
      type: "relation",
      label: "写真",
      config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
    });
    expect(result.definition.fields[1]).toStrictEqual({
      key: "slug",
      type: "text",
      label: "スラッグ",
      config: { unique: true },
    });
  });

  it("選択肢が無い select と参照先が無い reference は errors に key 付きで返る", () => {
    const draft: TypeDraft = {
      ...emptyTypeDraft(),
      name: "T",
      key: "t",
      fields: [emptyFieldDraft("select", "tags", "タグ"), emptyFieldDraft("reference", "rel", "")],
    };
    const result = buildDefinition({ id: uuid, version: 1, draft });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/tags/);
    expect(result.errors.join(" ")).toMatch(/rel/);
  });

  it("maxLength が不正な整数なら errors", () => {
    const field = { ...emptyFieldDraft("text", "title", ""), maxLength: "abc" };
    const draft: TypeDraft = { ...emptyTypeDraft(), name: "T", key: "t", fields: [field] };
    expect(buildDefinition({ id: uuid, version: 1, draft }).ok).toBe(false);
  });

  it("buildDefinition は titleField / listColumns の無くなった参照を落とし、menuOrder を運ぶ", () => {
    const draft: TypeDraft = {
      ...emptyTypeDraft(),
      name: "T",
      key: "t",
      description: "  説明  ",
      fields: [emptyFieldDraft("text", "title", ""), emptyFieldDraft("number", "price", "")],
      titleField: "gone",
      listColumns: ["price", "gone"],
    };
    const result = buildDefinition({ id: uuid, version: 2, menuOrder: 3, draft });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition).toMatchObject({
      description: "説明",
      listColumns: ["price"],
      menuOrder: 3,
      version: 2,
    });
    expect(result.definition.titleField).toBeUndefined();
    const kept = buildDefinition({
      id: uuid,
      version: 2,
      draft: { ...draft, titleField: "title" },
    });
    expect(kept.ok && kept.definition.titleField).toBe("title");
  });
});

describe("下書きの操作", () => {
  it("changeKind は表示名・API 名・説明・必須を保ち、設定を既定に戻す", () => {
    const original = {
      ...emptyFieldDraft("text", "sub", "副題"),
      description: "d",
      required: true,
      isNew: false,
      maxLength: "10",
      indexed: true,
    };
    const next = changeKind(original, "select");
    expect(next).toStrictEqual({
      ...emptyFieldDraft("select", "sub", "副題"),
      description: "d",
      required: true,
      isNew: false,
    });
  });

  it("availableKinds は key が slug のときだけ URL スラッグを含む", () => {
    expect(availableKinds(emptyFieldDraft("text", "slug", ""), false)).toContain("slug");
    expect(availableKinds(emptyFieldDraft("text", "slug", ""), true)).not.toContain("slug");
    expect(availableKinds(emptyFieldDraft("text", "title", ""), false)).not.toContain("slug");
    expect(availableKinds(emptyFieldDraft("text", "title", ""), false)).toStrictEqual([
      "text",
      "richtext",
      "number",
      "datetime",
      "boolean",
      "select",
      "asset",
      "reference",
      "json",
    ]);
  });

  it("hasSlugField は除外 key を無視する", () => {
    const list = [emptyFieldDraft("slug", "slug", "")];
    expect(hasSlugField(list)).toBe(true);
    expect(hasSlugField(list, "slug")).toBe(false);
  });

  it("effectiveTitleField は指定が text を指すときだけ指定、無ければ最初の text", () => {
    const base: TypeDraft = {
      ...emptyTypeDraft(),
      fields: [
        emptyFieldDraft("slug", "slug", ""),
        emptyFieldDraft("text", "a", ""),
        emptyFieldDraft("text", "b", ""),
      ],
    };
    expect(effectiveTitleField(base)).toBe("a");
    expect(effectiveTitleField({ ...base, titleField: "b" })).toBe("b");
    expect(effectiveTitleField({ ...base, titleField: "slug" })).toBe("a");
    expect(effectiveTitleField({ ...base, fields: [] })).toBeNull();
  });

  it("isTypeDraftEmpty は空の下書きだけ true", () => {
    const empty = emptyTypeDraft();
    expect(isTypeDraftEmpty(empty)).toBe(true);
    expect(isTypeDraftEmpty({ ...empty, name: "x" })).toBe(false);
    expect(isTypeDraftEmpty({ ...empty, key: "x" })).toBe(false);
    expect(isTypeDraftEmpty({ ...empty, description: "x" })).toBe(false);
    expect(isTypeDraftEmpty({ ...empty, fields: [emptyFieldDraft("text", "a", "A")] })).toBe(false);
    expect(isTypeDraftEmpty({ ...empty, listColumns: ["a"] })).toBe(false);
    expect(isTypeDraftEmpty({ ...empty, titleField: "x" })).toBe(false);
  });

  it("isTypeDraftDirty は構造を比べる", () => {
    const a = emptyTypeDraft();
    expect(isTypeDraftDirty(a, { ...a })).toBe(false);
    expect(isTypeDraftDirty(a, { ...a, name: "x" })).toBe(true);
  });
});

describe("API 名", () => {
  it("suggestKey は英字を含むときだけ snake_case を返す", () => {
    expect(suggestKey("Title")).toBe("title");
    expect(suggestKey("Sub-Title")).toBe("sub_title");
    expect(suggestKey("2nd Title")).toBe("nd_title");
    expect(suggestKey("タイトル")).toBe("");
  });

  it("autoFill は値が前回の提案と同じ間だけ追従する", () => {
    expect(autoFill("", "", "Title")).toBe("title");
    expect(autoFill("Title", "title", "Titles")).toBe("titles");
    expect(autoFill("Title", "my_title", "Titles")).toBe("my_title");
  });

  it("validateFieldKey は空・使えない文字(例つき)・重複・予約語を返す", () => {
    expect(validateFieldKey("Sub-Title", [])).toStrictEqual({
      kind: "invalid",
      example: "sub_title",
    });
    expect(validateFieldKey("title", [{ key: "title", label: "タイトル" }])).toStrictEqual({
      kind: "duplicate",
      label: "タイトル",
    });
    expect(validateFieldKey("id", [])).toStrictEqual({ kind: "reserved" });
    expect(validateFieldKey("", [])).toStrictEqual({ kind: "empty" });
    expect(validateFieldKey("title", [])).toBeNull();
  });

  it("validateTypeKey は既存の型(asset を含む)との重複を返す", () => {
    const existing = [
      { key: "asset", name: "アセット" },
      { key: "news", name: "お知らせ" },
    ];
    expect(validateTypeKey("asset", existing)).toStrictEqual({
      kind: "duplicate",
      label: "アセット",
    });
    expect(validateTypeKey("news", existing)).toStrictEqual({
      kind: "duplicate",
      label: "お知らせ",
    });
    expect(validateTypeKey("blog", existing)).toBeNull();
    expect(validateTypeKey("", existing)).toStrictEqual({ kind: "empty" });
    expect(validateTypeKey("ブログ", existing)).toMatchObject({ kind: "invalid" });
  });

  it("keyErrorMessage は文言を返す", () => {
    expect(keyErrorMessage({ kind: "invalid", example: "title" })).toContain("例: title");
    expect(keyErrorMessage({ kind: "duplicate", label: "題" })).toContain("「題」");
  });
});

describe("変更の検出", () => {
  const original: FieldDefinition = { key: "title", type: "text" };

  it("fieldChange は必須への変更と種類の変更を検出し、新規なら検出しない", () => {
    const draft = { ...toFieldDraft(original), required: true };
    expect(fieldChange(original, draft)).toStrictEqual({ requiredAdded: true, kindChanged: null });
    expect(fieldChange(original, changeKind(toFieldDraft(original), "number"))).toStrictEqual({
      requiredAdded: false,
      kindChanged: { from: "text", to: "number" },
    });
    expect(fieldChange(undefined, { ...draft, kind: "number" })).toStrictEqual({
      requiredAdded: false,
      kindChanged: null,
    });
    expect(fieldChange({ ...original, required: true }, draft).requiredAdded).toBe(false);
  });

  it("countEmpty / countFilled は削除済みを除き、空の定義どおりに数える", () => {
    const records = [
      record("k", ""),
      record("k", []),
      record("k", null),
      record("other", 1),
      record("k", "a"),
      record("k", ["x"]),
      record("k", 0),
      record("k", false),
      record("k", "", "2026-07-18T00:00:00Z"),
    ];
    expect(countEmpty(records, "k")).toBe(4);
    expect(countFilled(records, "k")).toBe(4);
  });

  it("fieldTags の順と内容", () => {
    const none = { requiredAdded: false, kindChanged: null };
    const text = { ...emptyFieldDraft("text", "title", "T"), required: true };
    expect(fieldTags(text, "title", none)).toStrictEqual(["必須", "タイトルに使う"]);
    const asset = {
      ...emptyFieldDraft("asset", "p", "P"),
      cardinality: "many" as const,
      indexed: true,
    };
    expect(fieldTags(asset, null, none)).toStrictEqual(["複数"]);
    expect(
      fieldTags({ ...emptyFieldDraft("reference", "r", "R"), allowedTypes: ["news"] }, null, none),
    ).toStrictEqual(["1 件だけ"]);
    const indexed = { ...emptyFieldDraft("number", "n", "N"), indexed: true };
    expect(fieldTags(indexed, null, none)).toStrictEqual(["絞り込み・並べ替え"]);
    expect(
      fieldTags(text, "title", {
        requiredAdded: true,
        kindChanged: { from: "number", to: "text" },
      }),
    ).toStrictEqual(["必須", "タイトルに使う", "必須に変更", "種類を変更"]);
  });
});

describe("summaryToDefinition", () => {
  it("drops row-only columns and null pluginId", () => {
    expect(summaryToDefinition(summary({ version: 4 }))).toStrictEqual({
      id: uuid,
      key: "article",
      name: "記事",
      fields: [],
      source: "user",
      version: 4,
    });
  });

  it("keeps display metadata", () => {
    const definition = summaryToDefinition(
      summary({ description: "d", titleField: "t", listColumns: ["a"], menuOrder: 2 }),
    );
    expect(definition).toMatchObject({
      description: "d",
      titleField: "t",
      listColumns: ["a"],
      menuOrder: 2,
    });
  });
});

const errorFields = (draft: FieldDraft) => fieldDraftErrors(draft).map((error) => error.field);

describe("fieldDraftErrors", () => {
  const P = FIELD_PANEL_LABELS;

  it("表示名が空でも fieldDraftErrors は空(既存データの互換)", () => {
    expect(
      fieldDraftErrors({ ...emptyFieldDraft("text", "title", ""), isNew: false }),
    ).toStrictEqual([]);
  });

  it("完成したフィールドはエラー無し", () => {
    expect(fieldDraftErrors(emptyFieldDraft("text", "title", "タイトル"))).toStrictEqual([]);
  });

  it("表示名は 100 文字以内(空は既存データの互換で許す)、説明は 500 文字以内", () => {
    expect(errorFields(emptyFieldDraft("text", "a", "  "))).toStrictEqual([]);
    expect(errorFields(emptyFieldDraft("text", "a", "あ".repeat(101)))).toStrictEqual(["label"]);
    const long = { ...emptyFieldDraft("text", "a", "A"), description: "あ".repeat(501) };
    expect(fieldDraftErrors(long)).toStrictEqual([
      { field: "description", message: P.descriptionTooLong(500) },
    ]);
  });

  it("最大文字数は空か正の整数", () => {
    const base = emptyFieldDraft("text", "a", "A");
    expect(fieldDraftErrors({ ...base, maxLength: "" })).toStrictEqual([]);
    expect(fieldDraftErrors({ ...base, maxLength: "10" })).toStrictEqual([]);
    expect(errorFields({ ...base, maxLength: "0" })).toStrictEqual(["maxLength"]);
    expect(errorFields({ ...base, maxLength: "1.5" })).toStrictEqual(["maxLength"]);
  });

  it("select は選択肢 1 件以上・表示名と値が空でなく値が重複しない", () => {
    const base = emptyFieldDraft("select", "c", "色");
    expect(fieldDraftErrors(base)).toStrictEqual([
      { field: "options", message: P.optionsRequired },
    ]);
    const messages = fieldDraftErrors({
      ...base,
      options: [
        { value: "", label: "" },
        { value: "r", label: "赤" },
        { value: "r", label: "赤2" },
      ],
    }).map((error) => error.message);
    expect(messages).toStrictEqual([
      P.optionLabelEmpty,
      P.optionValueEmpty,
      P.optionValueDuplicate("r"),
    ]);
  });

  it("reference は参照できる型が 1 つ以上必要", () => {
    const base = emptyFieldDraft("reference", "r", "関連");
    expect(errorFields(base)).toStrictEqual(["allowedTypes"]);
    expect(fieldDraftErrors({ ...base, allowedTypes: ["news"] })).toStrictEqual([]);
  });

  it("未完了の行には fieldTags が「設定が未完了」を足す", () => {
    const none = { requiredAdded: false, kindChanged: null };
    expect(fieldTags(emptyFieldDraft("select", "c", "色"), null, none)).toContain(
      CONTENT_TYPE_LABELS.tags.incomplete,
    );
  });
});
