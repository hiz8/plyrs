import * as stylex from "@stylexjs/stylex";
import { Lock, RotateCw } from "lucide-react";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { Collection } from "@tanstack/db";
import { v7 as uuidv7 } from "uuid";
import { ASSET_TYPE_KEY, type ContentTypeDefinition, type WorkflowStatus } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import {
  Banner,
  Button,
  ConfirmDialog,
  ICON_SIZE,
  ModalDialog,
  RelativeTime,
  toaster,
} from "@plyrs/ui";
import { bg, font, radius, space, text } from "@plyrs/ui/semantic.stylex";
import type { AssetServices } from "../lib/asset-services";
import { contentTypeCrumb, currentCrumb, homeCrumb, mediaCrumb } from "../lib/breadcrumbs";
import { formatDateTime } from "../lib/datetime";
import { errorMessage } from "../lib/error-messages";
import { DIALOGS, EDITOR_LABELS, PUBLISH_BOX, TOASTS } from "../lib/labels";
import { labelForRecord } from "../lib/record-label";
import { publishBoxView } from "../lib/publish-box";
import { publicationQueryOptions, publicationsQueryKey } from "../lib/queries";
import { useSaveAndPublish } from "../lib/save-and-publish";
import { useSyncStatus, useTenantSync } from "../lib/sync-context";
import { useCan } from "../lib/use-can";
import { useLeaveGuard } from "../lib/use-leave-guard";
import { PublishBar, PublishBox } from "./publish-box";
import { RecordForm, SaveDeferredError, type RecordFormHandle } from "./record-form";
import { PageBody, TenantPageHeader } from "./tenant-page-header";

// 幅 960px 未満では 1 列にし、公開の操作は下部固定バー(PublishBar)に移す
const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  body: {
    // 部品固有の値: 下部固定バーに本文の末尾が隠れないための余白(バーの高さ + 余裕)
    paddingBottom: { default: 0, [NARROW]: "88px" },
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    marginBottom: space.md,
    flexWrap: "wrap",
  },
  layout: {
    display: "grid",
    // 部品固有の値: 右列(公開ボックス)の幅。c-publish-box.md 2 章
    gridTemplateColumns: { default: "minmax(0, 1fr) 300px", [NARROW]: "1fr" },
    gap: space.xl,
    alignItems: "start",
  },
  side: { display: "flex", flexDirection: "column", gap: space.md },
  panel: {
    padding: space.md,
    borderRadius: radius.container,
    backgroundColor: bg.surface,
  },
  panelTitle: {
    margin: 0,
    marginBottom: space.sm,
    fontFamily: font.family,
    fontSize: font.body,
    fontWeight: font.weightMedium,
    color: text.default,
  },
  readOnlyMeta: { display: "inline-flex", alignItems: "center", gap: space.xs },
});

const tenantRoute = getRouteApi("/t/$tenantSlug");

function showSaveFailed(cause: unknown) {
  // 競合の「あとで決める」「取り込む」は利用者が選んだ結果なので通知しない
  if (cause instanceof SaveDeferredError) return;
  toaster.error(errorMessage(cause, TOASTS.saveFailed));
}

export interface RecordEditorProps {
  tenantSlug: string;
  contentType: ContentTypeDefinition;
  types: ContentTypeDefinition[];
  collection: Collection<SyncRecord, string>;
  /** null = 作成画面 */
  record: SyncRecord | null;
  assets: AssetServices;
}

export function RecordEditor({
  tenantSlug,
  contentType,
  types,
  collection,
  record,
  assets,
}: RecordEditorProps) {
  const { tenant, adminApi, queryClient, slots } = tenantRoute.useRouteContext();
  const sync = useTenantSync();
  const navigate = useNavigate();
  const connected = useSyncStatus(sync) === "ready";
  const canWrite = useCan("record:write");
  const canPublish = useCan("record:publish");
  const canDelete = useCan("record:delete");
  const formRef = useRef<RecordFormHandle>(null);
  // 作成画面で insert した record の ID。URL を編集画面へ置き換えるまでの公開に使う
  const createdId = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const saveAndPublish = useSaveAndPublish();
  const blocker = useLeaveGuard(dirty);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [pendingArchive, setPendingArchive] = useState(false);
  // 作成画面で選んだステータス(作成時の status に使う。編集画面では record.status が正)
  const [draftStatus, setDraftStatus] = useState<WorkflowStatus>("draft");
  // 下書き保存の実行中(連打で record が二重に作られるのを防ぐ。ref は同一 tick の連打用)
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // 確認ダイアログから実行した操作の進行中(ダイアログの isPending と公開ボックスの無効化に使う)
  const [busy, setBusy] = useState<"delete" | "unpublish" | "archive" | null>(null);

  const isNew = record === null;
  const isAsset = contentType.key === ASSET_TYPE_KEY;
  const typeKey = contentType.key;

  const publication = useQuery({
    ...publicationQueryOptions(adminApi, tenant.id, record?.id ?? ""),
    enabled: record !== null && !isAsset,
  });

  const view = publishBoxView({
    isNew,
    isAsset,
    publication: isNew || isAsset ? undefined : publication.data,
    publicationError: publication.isLoadingError,
    recordVersion: record?.version ?? 0,
    dirty,
    connected,
    canWrite,
    canPublish,
    canDelete,
    phase:
      busy === "delete"
        ? "deleting"
        : saveAndPublish.phase !== "idle"
          ? saveAndPublish.phase
          : saving
            ? "saving"
            : "idle",
  });

  const currentId = (): string | undefined => record?.id ?? createdId.current ?? undefined;

  async function invalidatePublication(id: string) {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: publicationQueryOptions(adminApi, tenant.id, id).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: publicationsQueryKey(tenant.id) }),
    ]);
  }

  // 作成画面は保存の確定後に編集画面の URL へ置き換える(離脱の確認は通さない)
  async function replaceWithEditUrl(id: string) {
    if (!isNew) return;
    await navigate({
      to: "/t/$tenantSlug/content/$typeKey/$recordId",
      params: { tenantSlug, typeKey, recordId: id },
      replace: true,
      ignoreBlocker: true,
    });
  }

  async function createRecord(input: Record<string, unknown>) {
    // design-spec §5: ID はクライアント生成(UUIDv7)。updatedAt/updatedBy/seq/version は
    // サーバー権威 — ack の確定レコードで上書きされる仮値を入れる。
    const id = uuidv7();
    const tx = collection.insert({
      id,
      type: typeKey,
      input,
      fieldVersions: {},
      status: draftStatus,
      seq: 0,
      version: 0,
      deletedAt: null,
      updatedAt: new Date().toISOString(),
      updatedBy: "",
    });
    await tx.isPersisted.promise;
    createdId.current = id;
  }

  async function updateRecord(id: string, input: Record<string, unknown>) {
    const tx = collection.update(id, (draft) => {
      // WritableDeep<SyncRecord>["input"] は SyncRecord["input"] と構造同一だが
      // WritableDeep の再帰展開で TS が同一視できないため境界 cast(rpc-unwrap 様式)。
      draft.input = input as typeof draft.input;
    });
    await tx.isPersisted.promise;
  }

  function showPublishFailed(id: string) {
    toaster.error(TOASTS.publishFailed, {
      label: TOASTS.retryPublish,
      icon: RotateCw,
      onAction: () => void retryPublish(id),
    });
  }

  // 保存は確定済みなので公開だけをやり直す
  async function retryPublish(id: string) {
    try {
      await adminApi.publishRecord(tenant.id, id);
    } catch {
      showPublishFailed(id);
      return;
    }
    await invalidatePublication(id);
    toaster.success(TOASTS.published);
  }

  async function onSecondary() {
    const form = formRef.current;
    if (savingRef.current || form === null || !form.validate()) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await form.save();
    } catch (cause) {
      showSaveFailed(cause);
      return;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    toaster.success(TOASTS.saved);
    const id = currentId();
    if (id !== undefined) await replaceWithEditUrl(id);
  }

  async function onPrimary() {
    if (savingRef.current) return;
    if (isAsset) {
      await onSecondary();
      return;
    }
    const result = await saveAndPublish.run({
      connected,
      validate: () => formRef.current?.validate() ?? false,
      save: isNew || dirty ? () => formRef.current?.save() ?? Promise.resolve() : undefined,
      publish: async () => {
        const id = currentId();
        if (id === undefined) throw new Error("record id is not decided");
        await adminApi.publishRecord(tenant.id, id);
      },
      wasPublished: publication.data?.published === true,
    });
    const id = currentId();
    if (result.ok) {
      toaster.success(result.outcome === "published" ? TOASTS.published : TOASTS.updated);
      if (id !== undefined) {
        await invalidatePublication(id);
        await replaceWithEditUrl(id);
      }
      return;
    }
    if (result.stage === "save") {
      showSaveFailed(result.cause);
    } else if (result.stage === "publish" && id !== undefined) {
      showPublishFailed(id);
      await replaceWithEditUrl(id);
    }
    // validate / offline はフィールドのエラーとボタンの無効化で伝わっている
  }

  function onStatusChange(next: WorkflowStatus) {
    // 作成画面はまだ record が無いので、作成時の status として覚えるだけにする
    if (isNew) {
      setDraftStatus(next);
      return;
    }
    // 公開中のアーカイブは確認を挟む(公開は維持されるため)
    if (next === "archived" && publication.data?.published === true) {
      setPendingArchive(true);
      return;
    }
    void updateStatus(next);
  }

  async function updateStatus(next: WorkflowStatus) {
    const id = currentId();
    if (id === undefined) return;
    try {
      const tx = collection.update(id, (draft) => {
        draft.status = next;
      });
      await tx.isPersisted.promise;
    } catch (cause) {
      toaster.error(errorMessage(cause, TOASTS.statusFailed));
      return;
    }
    toaster.success(TOASTS.statusChanged);
  }

  async function confirmArchive() {
    setBusy("archive");
    try {
      await updateStatus("archived");
    } finally {
      setBusy(null);
      setPendingArchive(false);
    }
  }

  async function confirmUnpublish() {
    const id = currentId();
    if (id === undefined) return;
    setBusy("unpublish");
    try {
      await adminApi.unpublishRecord(tenant.id, id);
      await invalidatePublication(id);
      toaster.success(TOASTS.unpublished);
    } catch (cause) {
      toaster.error(errorMessage(cause, TOASTS.unpublishFailed));
    } finally {
      setBusy(null);
      setUnpublishOpen(false);
    }
  }

  async function confirmDelete() {
    const id = currentId();
    if (id === undefined) return;
    setDeleteOpen(false);
    // 削除は楽観的に行が消えるので、編集画面が「見つかりません」に置き換わる前に移動する
    // (削除後は編集画面が無くなるので、離脱の確認は通さない)
    if (isAsset) {
      await navigate({ to: "/t/$tenantSlug/media", params: { tenantSlug }, ignoreBlocker: true });
    } else {
      await navigate({
        to: "/t/$tenantSlug/content/$typeKey",
        params: { tenantSlug, typeKey },
        ignoreBlocker: true,
      });
    }
    try {
      const tx = collection.delete(id);
      await tx.isPersisted.promise;
      await invalidatePublication(id);
    } catch (cause) {
      toaster.error(errorMessage(cause, TOASTS.deleteFailed));
      return;
    }
    toaster.success(TOASTS.deleted);
  }

  // 編集は record があれば更新、作成画面は insert。どちらも確定(isPersisted)まで待つ
  async function onSubmit(input: Record<string, unknown>) {
    if (record === null) {
      await createRecord(input);
    } else {
      await updateRecord(record.id, input);
    }
  }

  const title = isNew
    ? EDITOR_LABELS.addTitle(contentType.name)
    : canWrite
      ? EDITOR_LABELS.editTitle(contentType.name)
      : EDITOR_LABELS.viewTitle(contentType.name);
  const currentLabel = isNew
    ? EDITOR_LABELS.crumbNew
    : canWrite
      ? EDITOR_LABELS.crumbEdit
      : EDITOR_LABELS.crumbView;
  const breadcrumbs = [
    homeCrumb(tenantSlug),
    isAsset ? mediaCrumb(tenantSlug) : contentTypeCrumb(tenantSlug, contentType),
    currentCrumb(currentLabel),
  ];
  const lastUpdated =
    record === null ? null : (
      <>
        {PUBLISH_BOX.lastUpdated("")}
        <RelativeTime value={formatDateTime(record.updatedAt)} />
      </>
    );
  const meta =
    lastUpdated === null ? undefined : canWrite ? (
      <span>{lastUpdated}</span>
    ) : (
      <span {...stylex.props(styles.readOnlyMeta)}>
        <Lock size={ICON_SIZE.inline} aria-hidden="true" />
        {PUBLISH_BOX.readOnly} ・ {lastUpdated}
      </span>
    );

  const toolbar = record === null ? [] : slots.get("record-editor:toolbar");
  const panels = record === null ? [] : slots.get("record-editor:panel");

  return (
    <>
      <TenantPageHeader title={title} breadcrumbs={breadcrumbs} meta={meta} />
      <PageBody>
        <div {...stylex.props(styles.body)}>
          {toolbar.length > 0 && record !== null && (
            <div {...stylex.props(styles.toolbar)}>
              {toolbar.map((contribution) => (
                <contribution.render key={contribution.id} typeKey={typeKey} recordId={record.id} />
              ))}
            </div>
          )}
          <div {...stylex.props(styles.layout)}>
            <RecordForm
              contentType={contentType}
              types={types}
              registry={sync.registry}
              record={record}
              assets={assets}
              isReadOnly={!canWrite}
              onSubmit={onSubmit}
              onDirtyChange={setDirty}
              ref={formRef}
            />
            <aside {...stylex.props(styles.side)}>
              <PublishBox
                view={view}
                status={record?.status ?? draftStatus}
                onPrimary={() => void onPrimary()}
                onSecondary={() => void onSecondary()}
                onStatusChange={onStatusChange}
                onUnpublish={() => setUnpublishOpen(true)}
                onDelete={() => setDeleteOpen(true)}
                onRetryPublication={() => void publication.refetch()}
              />
              {record !== null &&
                panels.map((contribution) => (
                  <section key={contribution.id} {...stylex.props(styles.panel)}>
                    <h2 {...stylex.props(styles.panelTitle)}>{contribution.title}</h2>
                    <contribution.render typeKey={typeKey} recordId={record.id} />
                  </section>
                ))}
            </aside>
          </div>
        </div>
      </PageBody>
      <PublishBar
        view={view}
        onPrimary={() => void onPrimary()}
        onSecondary={() => void onSecondary()}
      />
      {record !== null && (
        <>
          <ConfirmDialog
            title={DIALOGS.delete.title(contentType.name)}
            isOpen={deleteOpen}
            onOpenChange={setDeleteOpen}
            tone="danger"
            confirmLabel={DIALOGS.delete.confirm}
            onConfirm={() => void confirmDelete()}
          >
            <p>{DIALOGS.delete.body(labelForRecord(types, record))}</p>
            {publication.data?.published === true && (
              <Banner tone="warning">{DIALOGS.delete.publishedWarning(contentType.name)}</Banner>
            )}
          </ConfirmDialog>
          <ConfirmDialog
            title={DIALOGS.unpublish.title}
            isOpen={unpublishOpen}
            onOpenChange={setUnpublishOpen}
            tone="danger"
            confirmLabel={DIALOGS.unpublish.confirm}
            isPending={busy === "unpublish"}
            onConfirm={() => void confirmUnpublish()}
          >
            <p>{DIALOGS.unpublish.body(labelForRecord(types, record))}</p>
          </ConfirmDialog>
          <ConfirmDialog
            title={DIALOGS.archivePublished.title}
            isOpen={pendingArchive}
            onOpenChange={setPendingArchive}
            tone="danger"
            confirmLabel={DIALOGS.archivePublished.confirm}
            isPending={busy === "archive"}
            onConfirm={() => void confirmArchive()}
          >
            <p>{DIALOGS.archivePublished.body(contentType.name)}</p>
          </ConfirmDialog>
        </>
      )}
      <ModalDialog
        title={DIALOGS.leave.title}
        isOpen={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        role="alertdialog"
        isDismissable={false}
        showCloseButton={false}
        footer={
          <>
            <Button variant="dangerLink" onPress={() => blocker.proceed?.()}>
              {DIALOGS.leave.discard}
            </Button>
            <Button autoFocus onPress={() => blocker.reset?.()}>
              {DIALOGS.leave.stay}
            </Button>
          </>
        }
      >
        <p>{DIALOGS.leave.body}</p>
      </ModalDialog>
    </>
  );
}
