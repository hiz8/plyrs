import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { SyncEngine, SyncRejectedError } from "@plyrs/sync-client";
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
  it("renders inputs per field type including the richtext editor", async () => {
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
    // richtext は Phase 7 で編集可能になった(プレースホルダーは廃止)
    expect(await screen.findByRole("textbox", { name: "body" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "body の書式" })).toBeInTheDocument();
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

const RECORD_ID = "018f2b6a-7a0a-7000-8000-000000000201";

function bodyEnvelope(text: string) {
  return {
    schemaVersion: 1,
    doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  };
}

function articleRecord(
  input: Record<string, unknown>,
  overrides: Partial<SyncRecord> = {},
): SyncRecord {
  return {
    id: RECORD_ID,
    type: "article",
    input,
    fieldVersions: { title: 1, body: 1 },
    status: "draft",
    seq: 2,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

function conflictError() {
  return new SyncRejectedError("conflict", "field conflicts: body", [
    { fieldKey: "body", baseVersion: 1, currentVersion: 2 },
  ]);
}

async function editBodyAndSave(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("textbox", { name: "body" });
  await user.click(screen.getByRole("button", { name: "見出し1" }));
  await user.click(screen.getByRole("button", { name: "保存" }));
}

describe("RecordForm dirty-only 保存(§12 必須②)", () => {
  it("writes only user-touched keys and keeps others' concurrent edits", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {});
    const registry = buildRegistry();
    const initial = articleRecord({ title: "旧タイトル", body: bodyEnvelope("旧本文") });
    const view = render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={initial}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    const title = await screen.findByRole("textbox", { name: "title" });
    await user.clear(title);
    await user.type(title, "自分の新タイトル");
    // 他編集者の本文変更が WS で届いた(= record プロップが最新化された)
    const updated = articleRecord(
      { title: "旧タイトル", body: bodyEnvelope("他者の新本文") },
      { fieldVersions: { title: 1, body: 2 }, version: 2, seq: 3 },
    );
    view.rerender(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={updated}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole("button", { name: "保存" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const input = onSubmit.mock.calls[0]?.[0];
    expect(input?.["title"]).toBe("自分の新タイトル");
    // 触っていない body は他者の版が生き残る(巻き戻さない)
    expect(input?.["body"]).toEqual(bodyEnvelope("他者の新本文"));
  });

  it("submits an edited richtext envelope from the toolbar path", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {});
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={articleRecord({ title: "t", body: bodyEnvelope("本文") })}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await screen.findByRole("textbox", { name: "body" });
    await user.click(screen.getByRole("button", { name: "見出し1" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const body = onSubmit.mock.calls[0]?.[0]?.["body"] as {
      schemaVersion: number;
      doc: { content: Array<{ type: string }> };
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.doc.content[0]?.type).toBe("heading");
  });
});

describe("RecordForm 本文競合(裁定 3)", () => {
  it("adopts the server version: resets the editor without re-submitting", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {
      throw conflictError();
    });
    const registry = buildRegistry();
    const initial = articleRecord({ title: "t", body: bodyEnvelope("旧本文") });
    const view = render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={initial}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await editBodyAndSave(user);
    // rollback 後の record プロップ = 他者の版(broadcast が先に適用されている)
    const serverSide = articleRecord(
      { title: "t", body: bodyEnvelope("他者の本文") },
      { fieldVersions: { title: 1, body: 2 }, version: 2, seq: 3 },
    );
    view.rerender(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={serverSide}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const dialog = await screen.findByRole("alertdialog", { name: "本文の競合" });
    expect(dialog).toHaveTextContent("自分の版");
    expect(dialog).toHaveTextContent("他者の本文");
    await user.click(screen.getByRole("button", { name: "サーバー版を採用" }));
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "body" })).toHaveTextContent("他者の本文");
    expect(onSubmit).toHaveBeenCalledTimes(1); // 再送はしない
  });

  it("keeps mine: re-submits the same draft as a clean overwrite", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>();
    onSubmit.mockRejectedValueOnce(conflictError());
    onSubmit.mockResolvedValueOnce(undefined);
    const registry = buildRegistry();
    const initial = articleRecord({ title: "t", body: bodyEnvelope("旧本文") });
    const view = render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={initial}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await editBodyAndSave(user);
    view.rerender(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={articleRecord(
          { title: "t", body: bodyEnvelope("他者の本文") },
          { fieldVersions: { title: 1, body: 2 }, version: 2, seq: 3 },
        )}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "自分の版で上書き保存" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const secondBody = onSubmit.mock.calls[1]?.[0]?.["body"] as {
      doc: { content: Array<{ type: string }> };
    };
    expect(secondBody.doc.content[0]?.type).toBe("heading");
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("blocks further submits while the conflict dialog is open", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {
      throw conflictError();
    });
    const registry = buildRegistry();
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={articleRecord({ title: "t", body: bodyEnvelope("旧本文") })}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await editBodyAndSave(user);
    await screen.findByRole("alertdialog", { name: "本文の競合" });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("silently succeeds when the conflicting server value equals my submission (§8 自己競合ガード)", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {
      throw conflictError();
    });
    const registry = buildRegistry();
    const initial = articleRecord({ title: "t", body: bodyEnvelope("旧本文") });
    const view = render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={initial}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await editBodyAndSave(user);
    // ack 消失後の再送シナリオ: サーバーの現在値 = 自分が送った版
    const myBody = onSubmit.mock.calls[0]?.[0]?.["body"] as Record<string, unknown>;
    view.rerender(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={registry}
        record={articleRecord(
          { title: "t", body: myBody },
          { fieldVersions: { title: 1, body: 2 }, version: 2, seq: 3 },
        )}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
