import { describe, expect, it } from "vitest";
import { publishBoxView, type PublishBoxInput } from "./publish-box";

const base: PublishBoxInput = {
  isNew: false,
  isAsset: false,
  publication: { published: false },
  recordVersion: 3,
  dirty: false,
  connected: true,
  canWrite: true,
  canPublish: true,
  canDelete: true,
  phase: "idle",
};
const published = (sourceVersion: number) =>
  ({
    published: true,
    publishedAt: "2026-10-17T01:00:00Z",
    publishedBy: "u1",
    sourceVersion,
  }) as const;

describe("publishBoxView", () => {
  it("公開状態の取得に失敗すると error 状態になり主ボタンは無効", () => {
    const view = publishBoxView({ ...base, publication: undefined, publicationError: true });
    expect(view.state).toStrictEqual({ kind: "error" });
    expect(view.primary?.isDisabled).toBe(true);
  });

  it("新規は公開が主ボタン、下書き保存が補助で、削除と取り下げは出ない", () => {
    const view = publishBoxView({ ...base, isNew: true, publication: undefined, dirty: true });
    expect(view.state).toEqual({ kind: "new" });
    expect(view.primary).toMatchObject({ kind: "publish", label: "公開", isDisabled: false });
    expect(view.secondary).toMatchObject({ kind: "save-draft", label: "下書き保存" });
    expect(view.showDelete).toBe(false);
    expect(view.showUnpublish).toBe(false);
    expect(view.notes.unsaved).toBe(false);
  });

  it("未公開は公開と下書き保存で、未保存の注記は dirty で出る", () => {
    const view = publishBoxView({ ...base, dirty: true });
    expect(view.state).toEqual({ kind: "unpublished" });
    expect(view.primary).toMatchObject({ kind: "publish", isDisabled: false });
    expect(view.secondary).toMatchObject({ kind: "save-draft", isDisabled: false });
    expect(view.notes).toEqual({ changed: false, unsaved: true });
    expect(view.showDelete).toBe(true);
    expect(view.showStatus).toBe(true);
  });

  it("公開中・未反映なし・未編集は更新が無効で補助ボタンが無い", () => {
    const view = publishBoxView({ ...base, publication: published(3), recordVersion: 3 });
    expect(view.state).toEqual({
      kind: "published",
      publishedAt: "2026-10-17T01:00:00Z",
      changed: false,
    });
    expect(view.primary).toMatchObject({
      kind: "update",
      label: "更新",
      isDisabled: true,
      disabledReason: undefined,
    });
    expect(view.secondary).toBeNull();
    expect(view.showUnpublish).toBe(true);
    expect(view.showDelete).toBe(true);
  });

  it("公開中・未反映ありは更新が有効で、公開せずに保存が補助になる", () => {
    const view = publishBoxView({ ...base, publication: published(2), recordVersion: 3 });
    expect(view.state).toMatchObject({ kind: "published", changed: true });
    expect(view.notes.changed).toBe(true);
    expect(view.primary).toMatchObject({ kind: "update", isDisabled: false });
    expect(view.secondary).toMatchObject({
      kind: "save-without-publish",
      label: "公開せずに保存",
    });
  });

  it("公開中・未反映なしでも未保存の変更があれば更新が有効になる", () => {
    const view = publishBoxView({ ...base, publication: published(3), dirty: true });
    expect(view.primary).toMatchObject({ kind: "update", isDisabled: false });
    expect(view.secondary).toMatchObject({ kind: "save-without-publish" });
    expect(view.notes).toEqual({ changed: false, unsaved: true });
  });

  it("切断中は公開が無効で理由と注記が付き、下書き保存は押せる", () => {
    const view = publishBoxView({ ...base, publication: { published: false }, connected: false });
    expect(view.primary).toMatchObject({
      isDisabled: true,
      disabledReason: "接続が切れているため公開できません",
    });
    expect(view.secondary).toMatchObject({ kind: "save-draft", isDisabled: false });
    expect(view.offlineNote).toBe(
      "接続が回復すると公開できます。「下書き保存」はこの端末に保存され、再接続後に送信されます",
    );
  });

  it("公開中の切断では補助ボタンの名前が注記に入り、補助が無ければ短い注記になる", () => {
    const withSecondary = publishBoxView({
      ...base,
      publication: published(2),
      recordVersion: 3,
      connected: false,
    });
    expect(withSecondary.primary).toMatchObject({ kind: "update", isDisabled: true });
    expect(withSecondary.offlineNote).toBe(
      "接続が回復すると公開できます。「公開せずに保存」はこの端末に保存され、再接続後に送信されます",
    );
    const without = publishBoxView({ ...base, publication: published(3), connected: false });
    expect(without.offlineNote).toBe("接続が回復すると公開できます");
  });

  it("閲覧者はボタンも取り下げも削除も出ず、未反映の注記は残る", () => {
    const view = publishBoxView({
      ...base,
      publication: published(2),
      recordVersion: 3,
      canWrite: false,
      canPublish: false,
      canDelete: false,
    });
    expect(view.readOnly).toBe(true);
    expect(view.primary).toBeNull();
    expect(view.secondary).toBeNull();
    expect(view.showUnpublish).toBe(false);
    expect(view.showDelete).toBe(false);
    expect(view.notes.changed).toBe(true);
  });

  it("asset は保存だけで、ステータスを出さず、未編集なら保存が無効", () => {
    const clean = publishBoxView({ ...base, isAsset: true, publication: undefined });
    expect(clean.state).toEqual({ kind: "asset" });
    expect(clean.primary).toMatchObject({ kind: "save", label: "保存", isDisabled: true });
    expect(clean.secondary).toBeNull();
    expect(clean.showStatus).toBe(false);
    expect(clean.showDelete).toBe(true);
    const dirty = publishBoxView({
      ...base,
      isAsset: true,
      publication: undefined,
      dirty: true,
      connected: false,
    });
    expect(dirty.primary).toMatchObject({ kind: "save", isDisabled: false });
    expect(dirty.offlineNote).toBeNull();
  });

  it("公開状態の取得前は公開が無効で、補助は下書き保存", () => {
    const view = publishBoxView({ ...base, publication: undefined });
    expect(view.state).toEqual({ kind: "loading" });
    expect(view.primary).toMatchObject({ kind: "publish", isDisabled: true });
    expect(view.secondary).toMatchObject({ kind: "save-draft" });
  });

  it("実行中は主ボタンも補助ボタンも無効になる", () => {
    const view = publishBoxView({ ...base, dirty: true, phase: "saving" });
    expect(view.primary?.isDisabled).toBe(true);
    expect(view.secondary?.isDisabled).toBe(true);
    const asset = publishBoxView({
      ...base,
      isAsset: true,
      publication: undefined,
      dirty: true,
      phase: "deleting",
    });
    expect(asset.primary?.isDisabled).toBe(true);
  });

  it("公開権限が無ければ主ボタンは無く、補助の保存だけ残る", () => {
    const view = publishBoxView({ ...base, canPublish: false, dirty: true });
    expect(view.primary).toBeNull();
    expect(view.secondary).toMatchObject({ kind: "save-draft" });
    expect(view.showUnpublish).toBe(false);
  });
});
