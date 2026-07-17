import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { SyncEngine } from "@plyrs/sync-client";
import { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { pendingConnect } from "../test-utils/fake-socket";
import { RecordForm, labelForRecord, syncErrorMessage } from "./record-form";

const authorType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000010",
  key: "author",
  name: "著者",
  source: "user",
  version: 1,
  fields: [{ key: "name", type: "text", required: true }],
};

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "featured", type: "boolean" },
    {
      key: "category",
      type: "select",
      config: {
        options: [
          { value: "tech", label: "Tech" },
          { value: "life", label: "Life" },
        ],
      },
    },
    { key: "body", type: "richtext" },
    {
      key: "authors",
      type: "relation",
      config: { allowedTypes: ["author"], cardinality: "many", ordered: true },
    },
  ],
};

const types = [articleType, authorType];

function author(id: string, name: string): SyncRecord {
  return {
    id,
    type: "author",
    input: { name },
    fieldVersions: { name: 1 },
    status: "draft",
    seq: 1,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
  };
}

function buildRegistry(): CollectionRegistry {
  const engine = new SyncEngine({ connect: pendingConnect });
  const registry = new CollectionRegistry(engine);
  registry.sync(types);
  registry.markReady();
  registry.applyStoreChange({
    kind: "upsert",
    record: author("018f2b6a-7a0a-7000-8000-000000000011", "山田"),
  });
  return registry;
}

describe("RecordForm", () => {
  it("renders inputs per field type with a read-only richtext placeholder", () => {
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={null}
        submitLabel="保存"
        onSubmit={async () => {}}
      />,
    );
    expect(screen.getByRole("textbox", { name: "title" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "featured" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /category/ })).toBeInTheDocument();
    expect(
      screen.getByText(/リッチテキスト（Phase 7 で編集できるようになります）/),
    ).toBeInTheDocument();
    // relation picker: 候補（山田）がチェックボックスで出る
    expect(screen.getByRole("checkbox", { name: /山田/ })).toBeInTheDocument();
  });

  it("submits the converted input", async () => {
    // vi.fn() の型は実装 `async () => {}` から推論され `.mock.calls` が 0 要素タプルになる
    // (JSX 側は引数少なめの関数を許す構造的部分型で通ってしまうため気づけない)。
    // calls[0]?.[0] で読むために、実際に呼ばれるシグネチャを明示する。
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {});
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={null}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "title" }), "hello");
    await user.click(screen.getByRole("checkbox", { name: /山田/ }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toStrictEqual({
      title: "hello",
      featured: false,
      authors: [{ type: "author", id: "018f2b6a-7a0a-7000-8000-000000000011" }],
    });
  });

  it("shows a field error for a required text left empty and does not submit", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={null}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "保存" }));
    // 空文字は record-form-values の setOrOmit でキー自体が省略されるため、zod は
    // min(1) の "too small" ではなく必須キー欠落の invalid_type("Invalid input: expected
    // string, received undefined")を返す(zod v4 実メッセージに合わせて正規表現を調整。
    // record-form-values の変換ロジック自体は変更していない)。
    expect(
      await screen.findAllByText(/(必須|least|small|short|invalid|undefined)/i),
    ).not.toHaveLength(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("surfaces onSubmit failures as an error banner (裁定 6 最小表現)", async () => {
    const onSubmit = vi.fn(async () => {
      throw Object.assign(new Error("title: too long"), {
        name: "SyncRejectedError",
        code: "validation_failed",
        conflicts: [],
      });
    });
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={null}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "title" }), "x");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/保存できませんでした/);
  });
});

describe("labelForRecord", () => {
  it("uses the first text field value and falls back to the id", () => {
    expect(labelForRecord(types, author("a1", "山田"))).toBe("山田");
    const noName = author("018f2b6a-7a0a-7000-8000-000000000012", "");
    expect(labelForRecord(types, { ...noName, input: {} })).toMatch(/^018f2b6a/);
  });
});

describe("syncErrorMessage", () => {
  it("formats SyncRejectedError with its code", () => {
    const error = Object.assign(new Error("boom"), {
      name: "SyncRejectedError",
      code: "unique_violation",
      conflicts: [],
    });
    expect(syncErrorMessage(error)).toMatch(/unique_violation/);
  });

  it("falls back for unknown errors", () => {
    expect(syncErrorMessage(new Error("x"))).toMatch(/保存できませんでした/);
  });
});
