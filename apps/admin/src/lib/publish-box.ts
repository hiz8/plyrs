import type { PublicationState } from "./admin-api";
import { PUBLISH_BOX } from "./labels";
import type { SaveAndPublishPhase } from "./save-and-publish";

// 編集画面の公開ボックス(案 C 3 章)で、どのボタンを出し、どれを無効にし、
// どの注記を出すかを決める純関数。部品はこの結果を描くだけにする。

export interface PublishBoxInput {
  isNew: boolean;
  isAsset: boolean;
  /** undefined = 取得前(新規・asset では常に undefined) */
  publication: PublicationState | undefined;
  /** 公開状態の取得に失敗した(新規・asset では無視する) */
  publicationError?: boolean;
  recordVersion: number;
  dirty: boolean;
  connected: boolean;
  canWrite: boolean;
  canPublish: boolean;
  canDelete: boolean;
  phase: SaveAndPublishPhase | "deleting";
}

export type PublishBoxButtonKind =
  | "publish"
  | "update"
  | "save-draft"
  | "save-without-publish"
  | "save";

export interface PublishBoxButton {
  kind: PublishBoxButtonKind;
  label: string;
  isDisabled: boolean;
  disabledReason: string | undefined;
}

export type PublishBoxState =
  | { kind: "new" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "unpublished" }
  | { kind: "asset" }
  | { kind: "published"; publishedAt: string; changed: boolean };

export interface PublishBoxView {
  /** canWrite が false */
  readOnly: boolean;
  state: PublishBoxState;
  notes: { changed: boolean; unsaved: boolean };
  primary: PublishBoxButton | null;
  secondary: PublishBoxButton | null;
  /** asset では false */
  showStatus: boolean;
  showUnpublish: boolean;
  showDelete: boolean;
  offlineNote: string | null;
}

function button(
  kind: PublishBoxButtonKind,
  label: string,
  isDisabled: boolean,
  disabledReason?: string,
): PublishBoxButton {
  return { kind, label, isDisabled, disabledReason };
}

export function publishBoxView(input: PublishBoxInput): PublishBoxView {
  const { isNew, isAsset, publication, dirty, connected, canWrite, canPublish, phase } = input;
  const idle = phase === "idle";
  const changed =
    publication?.published === true && input.recordVersion > publication.sourceVersion;
  const notes = { changed, unsaved: dirty && !isNew };
  const showDelete = canWrite && input.canDelete && !isNew;

  let state: PublishBoxState;
  if (isAsset) state = { kind: "asset" };
  else if (isNew) state = { kind: "new" };
  else if (input.publicationError === true) state = { kind: "error" };
  else if (publication === undefined) state = { kind: "loading" };
  else if (publication.published) {
    state = { kind: "published", publishedAt: publication.publishedAt, changed };
  } else state = { kind: "unpublished" };

  const build = (
    primary: PublishBoxButton | null,
    secondary: PublishBoxButton | null,
    showUnpublish: boolean,
  ): PublishBoxView => ({
    readOnly: !canWrite,
    state,
    notes,
    primary: canWrite ? primary : null,
    secondary: canWrite ? secondary : null,
    showStatus: !isAsset,
    showUnpublish: canWrite && showUnpublish,
    showDelete,
    offlineNote:
      canWrite && !connected && !isAsset && primary !== null
        ? PUBLISH_BOX.offlineNote(secondary?.label ?? null)
        : null,
  });

  if (isAsset) {
    return build(button("save", PUBLISH_BOX.save, !dirty || !idle), null, false);
  }

  // 公開系の主ボタンは切断中に理由つきで無効になる(補助の保存は端末に積めるので押せる)
  const reason = connected ? undefined : PUBLISH_BOX.offlineReason;

  if (state.kind === "published") {
    const edited = changed || dirty;
    const primary = canPublish
      ? button("update", PUBLISH_BOX.update, !idle || !edited || !connected, reason)
      : null;
    const secondary = edited
      ? button("save-without-publish", PUBLISH_BOX.saveWithoutPublish, !idle)
      : null;
    return build(primary, secondary, canPublish);
  }

  const primary = canPublish
    ? button(
        "publish",
        PUBLISH_BOX.publish,
        !idle || state.kind === "loading" || state.kind === "error" || !connected,
        reason,
      )
    : null;
  return build(primary, button("save-draft", PUBLISH_BOX.saveDraft, !idle), false);
}
