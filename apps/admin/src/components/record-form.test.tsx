import { ASSET_TYPE_DEFINITION, type ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { SyncEngine, SyncRejectedError } from "@plyrs/sync-client";
import { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AssetServices } from "../lib/asset-services";
import { labelForRecord } from "../lib/record-label";
import { pendingConnect } from "../test-utils/fake-socket";
import { RecordForm, SaveDeferredError, type RecordFormHandle } from "./record-form";

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

const handle = createRef<RecordFormHandle>();

// 公開ボックスの保存ボタン相当。競合ダイアログの解決待ちで止まることがあるため await しない
function startSave(): Promise<void> {
  let pending!: Promise<void>;
  act(() => {
    if (handle.current === null) {
      throw new Error("handle is not attached");
    }
    pending = handle.current.save();
  });
  return pending;
}

async function saveForm(): Promise<void> {
  await act(async () => {
    await startSave();
  });
}

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
        onDirtyChange={() => {}}
        ref={handle}
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
        onDirtyChange={() => {}}
        ref={handle}
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "title" }), "hello");
    await user.click(screen.getByRole("checkbox", { name: /山田/ }));
    await saveForm();
    expect(onSubmit).toHaveBeenCalledTimes(1);
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
        onDirtyChange={() => {}}
        ref={handle}
        onSubmit={onSubmit}
      />,
    );
    let valid = true;
    act(() => {
      valid = handle.current?.validate() ?? true;
    });
    expect(valid).toBe(false);
    // 空文字は record-form-values の setOrOmit でキー自体が省略されるため、zod は
    // min(1) の "too small" ではなく必須キー欠落の invalid_type("Invalid input: expected
    // string, received undefined")を返す(zod v4 実メッセージに合わせて正規表現を調整。
    // record-form-values の変換ロジック自体は変更していない)。
    expect(
      await screen.findAllByText(/(必須|least|small|short|invalid|undefined)/i),
    ).not.toHaveLength(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("save は onSubmit の失敗を cause のまま投げ、画面にエラー文は出さない", async () => {
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
        onDirtyChange={() => {}}
        ref={handle}
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "title" }), "x");
    let caught: unknown;
    await act(async () => {
      caught = await startSave().catch((cause: unknown) => cause);
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("title: too long");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("onDirtyChange は入力で true、save の後に false になる", async () => {
    const onDirtyChange = vi.fn<(dirty: boolean) => void>();
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={null}
        onDirtyChange={onDirtyChange}
        ref={handle}
        onSubmit={async () => {}}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "title" }), "hello");
    await vi.waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    await saveForm();
    await vi.waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it("validate は必須の空欄にエラーを出して false を返し、保存しない", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={null}
        onDirtyChange={() => {}}
        ref={handle}
        onSubmit={onSubmit}
      />,
    );
    let valid = true;
    act(() => {
      valid = handle.current?.validate() ?? true;
    });
    expect(valid).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    // 最初のエラーの入力欄へフォーカスが移る
    await vi.waitFor(() => expect(screen.getByRole("textbox", { name: "title" })).toHaveFocus());
    await expect(startSave()).rejects.toThrow();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("isReadOnly は入力欄を readonly にし本文のツールバーを出さない", async () => {
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={articleRecord({ title: "t", body: bodyEnvelope("本文") })}
        onDirtyChange={() => {}}
        ref={handle}
        isReadOnly
        onSubmit={async () => {}}
      />,
    );
    expect(screen.getByRole("textbox", { name: "title" })).toHaveAttribute("readonly");
    await screen.findByRole("textbox", { name: "body" });
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("フィールドの label と description を出す", () => {
    const labeled: ContentTypeDefinition = {
      ...articleType,
      fields: [{ key: "title", type: "text", label: "タイトル", description: "一覧に使います" }],
    };
    render(
      <RecordForm
        contentType={labeled}
        types={[labeled]}
        registry={buildRegistry()}
        record={null}
        onDirtyChange={() => {}}
        ref={handle}
        onSubmit={async () => {}}
      />,
    );
    expect(screen.getByRole("textbox", { name: "タイトル" })).toBeInTheDocument();
    expect(screen.getByText("一覧に使います")).toBeInTheDocument();
  });
});

describe("datetime フィールドの形式ヒント", () => {
  const eventType: ContentTypeDefinition = {
    id: "018f2b6a-7a0a-7000-8000-000000000020",
    key: "event",
    name: "イベント",
    source: "user",
    version: 1,
    fields: [{ key: "starts_at", type: "datetime" }],
  };

  function buildEventRegistry(): CollectionRegistry {
    const engine = new SyncEngine({ connect: pendingConnect });
    const registry = new CollectionRegistry(engine);
    registry.sync([eventType]);
    registry.markReady();
    return registry;
  }

  it("shows a UTC 'Z'-terminated ISO 8601 example as placeholder and description", () => {
    render(
      <RecordForm
        contentType={eventType}
        types={[eventType]}
        registry={buildEventRegistry()}
        record={null}
        onDirtyChange={() => {}}
        ref={handle}
        onSubmit={async () => {}}
      />,
    );
    const input = screen.getByRole("textbox", { name: "starts_at" });
    expect(input).toHaveAttribute("placeholder", "2026-10-01T00:20:00Z");
    expect(screen.getByText(/Z 終端/)).toBeInTheDocument();
  });
});

describe("labelForRecord", () => {
  it("uses the first text field value and falls back to the id", () => {
    expect(labelForRecord(types, author("a1", "山田"))).toBe("山田");
    const noName = author("018f2b6a-7a0a-7000-8000-000000000012", "");
    expect(labelForRecord(types, { ...noName, input: {} })).toMatch(/^018f2b6a/);
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

async function editBody(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("textbox", { name: "body" });
  await user.click(screen.getByRole("button", { name: "見出し1" }));
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
        onDirtyChange={() => {}}
        ref={handle}
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
        onDirtyChange={() => {}}
        ref={handle}
        onSubmit={onSubmit}
      />,
    );
    await saveForm();
    expect(onSubmit).toHaveBeenCalledTimes(1);
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
        onDirtyChange={() => {}}
        ref={handle}
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await screen.findByRole("textbox", { name: "body" });
    await user.click(screen.getByRole("button", { name: "見出し1" }));
    await saveForm();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const body = onSubmit.mock.calls[0]?.[0]?.["body"] as {
      schemaVersion: number;
      doc: { content: Array<{ type: string }> };
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.doc.content[0]?.type).toBe("heading");
  });
});

function conflictForm(
  registry: CollectionRegistry,
  record: SyncRecord,
  onSubmit: (input: Record<string, unknown>) => Promise<void>,
) {
  return (
    <RecordForm
      contentType={articleType}
      types={types}
      registry={registry}
      record={record}
      onDirtyChange={() => {}}
      ref={handle}
      onSubmit={onSubmit}
    />
  );
}

const THEIRS_META = { fieldVersions: { title: 1, body: 2 }, version: 2, seq: 3 };

describe("RecordForm 本文競合(裁定 3 / R10)", () => {
  it("「あとで決める」を選ぶと save は SaveDeferredError を投げ、下書きは残る", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {
      throw conflictError();
    });
    const registry = buildRegistry();
    const view = render(
      conflictForm(registry, articleRecord({ title: "t", body: bodyEnvelope("旧本文") }), onSubmit),
    );
    const user = userEvent.setup();
    await editBody(user);
    const pending = startSave();
    const settled = pending.catch((cause: unknown) => cause);
    view.rerender(
      conflictForm(
        registry,
        articleRecord({ title: "t", body: bodyEnvelope("他者の本文") }, THEIRS_META),
        onSubmit,
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "本文が他の人の編集と重なりました" });
    expect(dialog).toHaveTextContent("他者の本文");
    await user.click(screen.getByRole("button", { name: "あとで決める" }));
    expect(await settled).toBeInstanceOf(SaveDeferredError);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // 下書き(見出し化した自分の本文)は残っている
    expect(screen.getByRole("textbox", { name: "body" }).querySelector("h1")).not.toBeNull();
  });

  it("「ほかの人の編集を取り込む」でサーバー版をエディタに写し、再送せず SaveDeferredError", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {
      throw conflictError();
    });
    const registry = buildRegistry();
    const view = render(
      conflictForm(registry, articleRecord({ title: "t", body: bodyEnvelope("旧本文") }), onSubmit),
    );
    const user = userEvent.setup();
    await editBody(user);
    const settled = startSave().catch((cause: unknown) => cause);
    view.rerender(
      conflictForm(
        registry,
        articleRecord({ title: "t", body: bodyEnvelope("他者の本文") }, THEIRS_META),
        onSubmit,
      ),
    );
    await screen.findByRole("dialog", { name: "本文が他の人の編集と重なりました" });
    await user.click(screen.getByRole("button", { name: "ほかの人の編集を取り込む" }));
    expect(await settled).toBeInstanceOf(SaveDeferredError);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "body" })).toHaveTextContent("他者の本文");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("「あなたの編集を残す」を選ぶと再送して save が成功する", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>();
    onSubmit.mockRejectedValueOnce(conflictError());
    onSubmit.mockResolvedValueOnce(undefined);
    const registry = buildRegistry();
    const view = render(
      conflictForm(registry, articleRecord({ title: "t", body: bodyEnvelope("旧本文") }), onSubmit),
    );
    const user = userEvent.setup();
    await editBody(user);
    const pending = startSave();
    view.rerender(
      conflictForm(
        registry,
        articleRecord({ title: "t", body: bodyEnvelope("他者の本文") }, THEIRS_META),
        onSubmit,
      ),
    );
    await screen.findByRole("dialog", { name: "本文が他の人の編集と重なりました" });
    await user.click(screen.getByRole("button", { name: "あなたの編集を残す" }));
    await expect(pending).resolves.toBeUndefined();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    const secondBody = onSubmit.mock.calls[1]?.[0]?.["body"] as {
      doc: { content: Array<{ type: string }> };
    };
    expect(secondBody.doc.content[0]?.type).toBe("heading");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("サーバー側で本文が削除されていたら、取り込みでエディタを空にする", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {
      throw conflictError();
    });
    const registry = buildRegistry();
    const view = render(
      conflictForm(registry, articleRecord({ title: "t", body: bodyEnvelope("旧本文") }), onSubmit),
    );
    const user = userEvent.setup();
    await editBody(user);
    const settled = startSave().catch((cause: unknown) => cause);
    view.rerender(conflictForm(registry, articleRecord({ title: "t" }, THEIRS_META), onSubmit));
    const dialog = await screen.findByRole("dialog", { name: "本文が他の人の編集と重なりました" });
    expect(dialog).toHaveTextContent("（空）");
    await user.click(screen.getByRole("button", { name: "ほかの人の編集を取り込む" }));
    expect(await settled).toBeInstanceOf(SaveDeferredError);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "body" })).not.toHaveTextContent("旧本文");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("新規作成で conflict が返っても競合扱いにせず cause を投げる", async () => {
    const cause = conflictError();
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {
      throw cause;
    });
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={null}
        onDirtyChange={() => {}}
        ref={handle}
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "title" }), "x");
    let caught: unknown;
    await act(async () => {
      caught = await startSave().catch((error: unknown) => error);
    });
    expect(caught).toBe(cause);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("競合待ち中にアンマウントすると save は SaveDeferredError で終わる", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {
      throw conflictError();
    });
    const view = render(
      conflictForm(
        buildRegistry(),
        articleRecord({ title: "t", body: bodyEnvelope("旧本文") }),
        onSubmit,
      ),
    );
    const user = userEvent.setup();
    await editBody(user);
    const settled = startSave().catch((error: unknown) => error);
    await screen.findByRole("dialog", { name: "本文が他の人の編集と重なりました" });
    view.unmount();
    expect(await settled).toBeInstanceOf(SaveDeferredError);
  });

  it("競合したサーバーの値が自分の送信値と同じなら、静かに保存成功にする(§8 自己競合ガード)", async () => {
    const onSubmit = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {
      throw conflictError();
    });
    const registry = buildRegistry();
    const view = render(
      conflictForm(registry, articleRecord({ title: "t", body: bodyEnvelope("旧本文") }), onSubmit),
    );
    const user = userEvent.setup();
    await editBody(user);
    const pending = startSave();
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const myBody = onSubmit.mock.calls[0]?.[0]?.["body"] as Record<string, unknown>;
    view.rerender(
      conflictForm(registry, articleRecord({ title: "t", body: myBody }, THEIRS_META), onSubmit),
    );
    await expect(pending).resolves.toBeUndefined();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

const mediaType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000040",
  key: "media",
  name: "メディア記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    {
      key: "hero",
      type: "relation",
      config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
    },
  ],
};

const assetTypeDefinition = ASSET_TYPE_DEFINITION;

const ASSET_RECORD_ID = "018f2b6a-7a0a-7000-8000-0000000000f0";

function assetRecordFixture(): SyncRecord {
  return {
    id: ASSET_RECORD_ID,
    type: "asset",
    input: {
      filename: "hero.png",
      content_type: "image/png",
      size: 2048,
      r2_key: "t1/assets/hero.png",
    },
    fieldVersions: { filename: 1, content_type: 1, size: 1, r2_key: 1 },
    status: "draft",
    seq: 1,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
  };
}

const assetRecord = assetRecordFixture();

function buildRegistryWithAsset(): CollectionRegistry {
  const engine = new SyncEngine({ connect: pendingConnect });
  const registry = new CollectionRegistry(engine);
  registry.sync([mediaType, assetTypeDefinition]);
  registry.markReady();
  registry.applyStoreChange({ kind: "upsert", record: assetRecord });
  return registry;
}

const registryWithAsset = buildRegistryWithAsset();

function assetServicesStub(overrides: Partial<AssetServices> = {}): AssetServices {
  return {
    upload: vi.fn(async () => ({ id: "018f2b6a-7a0a-7000-8000-0000000000f1" })),
    resolveUrl: vi.fn(async () => null),
    ...overrides,
  };
}

describe("メディアフィールド (Phase 8 裁定: メディア UI)", () => {
  it("renders the asset picker for allowedTypes=['asset'] fields and selects from the dialog", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    render(
      <RecordForm
        contentType={mediaType}
        types={[mediaType, assetTypeDefinition]}
        registry={registryWithAsset}
        record={null}
        onDirtyChange={() => {}}
        ref={handle}
        onSubmit={onSubmit}
        assets={assetServicesStub()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "メディアを選択" }));
    const dialog = await screen.findByRole("dialog", { name: "メディアを選択" });
    expect(dialog).toHaveTextContent("hero.png");
    await user.click(within(dialog).getByText("hero.png"));
    await user.click(within(dialog).getByRole("button", { name: "このファイルを使う" }));
    // 選択結果がフィールドに表示される
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("hero.png", { selector: "span" })).toBeInTheDocument();
  });

  it("falls back to the plain RelationPicker without the assets prop", () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <RecordForm
        contentType={mediaType}
        types={[mediaType, assetTypeDefinition]}
        registry={registryWithAsset}
        record={null}
        onDirtyChange={() => {}}
        ref={handle}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.queryByRole("button", { name: "メディアを選択" })).not.toBeInTheDocument();
  });

  it("disables system-managed inputs when editing an asset record", () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <RecordForm
        contentType={assetTypeDefinition}
        types={[assetTypeDefinition]}
        registry={registryWithAsset}
        record={assetRecord}
        onDirtyChange={() => {}}
        ref={handle}
        onSubmit={onSubmit}
        assets={assetServicesStub()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "filename" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "r2_key" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "alt" })).toBeEnabled();
  });
});
