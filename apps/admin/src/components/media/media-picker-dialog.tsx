import * as stylex from "@stylexjs/stylex";
import {
  Badge,
  Button,
  FileButton,
  FileDropTarget,
  ModalDialog,
  SearchField,
  TextField,
  TileGrid,
  UploadTile,
  toaster,
} from "@plyrs/ui";
import { border, font, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import { ASSET_TYPE_KEY, type ContentTypeDefinition } from "@plyrs/metamodel";
import type { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import { Check, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetServices } from "../../lib/asset-services";
import { errorMessage } from "../../lib/error-messages";
import { MEDIA_LABELS, MEDIA_PICKER_LABELS, TOASTS } from "../../lib/labels";
import {
  MEDIA_KIND_OPTIONS,
  isMediaKindOrAll,
  applyMediaQuery,
  buildMediaRows,
  extensionOf,
  formatBytes,
  mediaKindOf,
  type MediaKind,
  type MediaRow,
} from "../../lib/media-list";
import { useFileDropGuard } from "../../lib/use-file-drop-guard";
import { createUploadStore, DONE_HOLD_MS, useUploads } from "../../lib/use-uploads";
import { useRecordsOfTypes } from "../../lib/use-collection";
import { uploadTileState } from "./media-grid";
import { MediaFilterSelect } from "./media-filter-select";
import { MediaThumb } from "./media-thumb";

// 幅 960px 未満は「選択中」欄をグリッドの下に回す(F33)
const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: space.sm },
  titleRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  note: { fontSize: font.caption, color: text.muted },
  columns: {
    display: "flex",
    flex: 1,
    minHeight: 0,
    flexDirection: { default: "row", [NARROW]: "column" },
    gap: space.md,
    overflow: { default: "visible", [NARROW]: "auto" },
  },
  left: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    gap: space.inset,
    overflow: { default: "auto", [NARROW]: "visible" },
  },
  filters: { display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  search: { flex: 1, minWidth: 0 },
  // F5 章: 右の「選択中」欄は 300px(D3 M9・M10)
  right: {
    display: "flex",
    flexDirection: "column",
    gap: space.inset,
    width: { default: "300px", [NARROW]: "auto" },
    flexShrink: 0,
    paddingInlineStart: { default: space.md, [NARROW]: 0 },
    paddingBlockStart: { default: 0, [NARROW]: space.md },
    borderInlineStartWidth: { default: stroke.default, [NARROW]: 0 },
    borderBlockStartWidth: { default: 0, [NARROW]: stroke.default },
    borderStyle: "solid",
    borderColor: border.default,
    overflowY: { default: "auto", [NARROW]: "visible" },
  },
  count: { fontSize: font.body, fontWeight: font.weightBold, color: text.default },
  none: { fontSize: font.body, color: text.muted },
  item: { display: "flex", flexDirection: "column", gap: space.sm },
  itemHead: { display: "flex", gap: space.sm, alignItems: "center", minWidth: 0 },
  itemText: { display: "flex", flexDirection: "column", minWidth: 0 },
  filename: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: font.familyMono,
    fontSize: font.caption,
    color: text.default,
  },
  meta: { fontSize: font.caption, color: text.muted },
  footerHint: { marginInlineEnd: "auto", fontSize: font.caption, color: text.muted },
});

export interface PickedMedia {
  id: string;
  label: string;
  alt: string;
}

export interface MediaPickerDialogProps {
  registry: CollectionRegistry;
  types: ContentTypeDefinition[];
  assets: AssetServices;
  /** 題の横に出すフィールド名(本文の画像は MEDIA_PICKER_LABELS.bodyField) */
  fieldName: string;
  selection: "one" | "many";
  /** F32: 種類の絞り込みの初期値 */
  defaultKind: MediaKind | "all";
  /** 既に選ばれている id(選択順の先頭に置く。one は先頭の 1 件) */
  initialIds?: readonly string[];
  /** 呼び出し側が閉じる */
  onSelect: (items: PickedMedia[]) => void;
  onClose: () => void;
}

// アップロード直後でレコードが同期で届くまでの仮の項目(F30)
interface Provisional {
  filename: string;
  size: number;
  kind: MediaKind;
}

interface SelectedItem {
  id: string;
  filename: string;
  row: MediaRow | undefined;
  provisional: Provisional | undefined;
}

// 案 F 5 章(D3 M9・M10)。F30: 選んだ順・アップロード、F31: 代替テキスト、F32: 種類の既定
export function MediaPickerDialog({
  registry,
  types,
  assets,
  fieldName,
  selection,
  defaultKind,
  initialIds = [],
  onSelect,
  onClose,
}: MediaPickerDialogProps) {
  useFileDropGuard();
  const many = selection === "many";
  const typeKeys = useMemo(
    () => (types.some((type) => type.key === ASSET_TYPE_KEY) ? [ASSET_TYPE_KEY] : []),
    [types],
  );
  const records = useRecordsOfTypes(registry, typeKeys);
  const rows = useMemo(() => buildMediaRows(records), [records]);
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  const [kind, setKind] = useState<MediaKind | "all">(defaultKind);
  const [q, setQ] = useState("");
  const visible = useMemo(
    () => applyMediaQuery(rows, { kind, usage: "all", q, sort: "newest" }, null),
    [rows, kind, q],
  );

  // F30: 選んだ順。many だけが番号を持つ
  const [orderedIds, setOrderedIds] = useState<string[]>(() =>
    many ? [...initialIds] : initialIds.slice(0, 1),
  );
  // F31: 代替テキストの下書き(触った id だけ。無ければレコードの値)
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [provisionals, setProvisionals] = useState<Record<string, Provisional>>({});
  const [uploadedIds, setUploadedIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  // ダイアログを閉じても進行中のアップロードは中断しない(asset は作られるが、選択には入らない)
  const store = useMemo(() => createUploadStore(assets.upload), [assets]);
  const uploads = useUploads(store);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    store.setOptions({
      onDone: (assetId, file) => {
        setProvisionals((prev) => ({
          ...prev,
          [assetId]: { filename: file.name, size: file.size, kind: mediaKindOf(file.type) },
        }));
        setOrderedIds((prev) =>
          many ? (prev.includes(assetId) ? prev : [...prev, assetId]) : [assetId],
        );
        setUploadedIds((prev) => new Set(prev).add(assetId));
        setPendingFocusId(assetId);
        const timer = setTimeout(() => {
          pending.delete(timer);
          setUploadedIds((prev) => {
            const next = new Set(prev);
            next.delete(assetId);
            return next;
          });
        }, DONE_HOLD_MS);
        pending.add(timer);
      },
    });
    return () => {
      store.setOptions({});
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, [store, many]);

  // 代替テキストの入力欄はレコードが届いた時点で現れ、autoFocus で受ける。その後は消化済みにする
  useEffect(() => {
    if (pendingFocusId !== null && rowsById.has(pendingFocusId)) setPendingFocusId(null);
  }, [pendingFocusId, rowsById]);

  const selectedItems: SelectedItem[] = orderedIds.flatMap((id) => {
    const row = rowsById.get(id);
    const provisional = provisionals[id];
    if (row === undefined && provisional === undefined) return [];
    return [{ id, filename: row?.filename ?? provisional?.filename ?? "", row, provisional }];
  });

  function onSelectionChange(keys: Set<string>) {
    if (!many) {
      const next = [...keys].find((key) => !orderedIds.includes(key)) ?? [...keys][0];
      setOrderedIds(next === undefined ? [] : [next]);
      return;
    }
    setOrderedIds([
      ...orderedIds.filter((id) => keys.has(id)),
      ...[...keys].filter((id) => !orderedIds.includes(id)),
    ]);
  }

  const altOf = (item: SelectedItem) => drafts[item.id] ?? item.row?.alt ?? "";

  // F31(2026-10-24 改定): 変えた代替テキストだけを asset レコードへ書く。update は楽観更新で outbox が
  // 配信するので、サーバーの確定は待たずに挿入へ進み、失敗は非同期にトーストで知らせる
  function insert() {
    const collection = registry.get(ASSET_TYPE_KEY);
    const persisted: Promise<unknown>[] = [];
    for (const item of selectedItems) {
      const alt = altOf(item);
      if (collection === undefined || item.row === undefined || alt === item.row.alt) continue;
      try {
        const tx = collection.update(item.id, (draft) => {
          // updateRecord(record-editor.tsx)と同じ境界 cast
          // F13 と同じく、空なら alt の key ごと落とす
          const { alt: _previous, ...rest } = draft.input as Record<string, unknown>;
          draft.input = (alt === "" ? rest : { ...rest, alt }) as typeof draft.input;
        });
        persisted.push(tx.isPersisted.promise);
      } catch (cause) {
        toaster.error(errorMessage(cause, TOASTS.saveFailed));
      }
    }
    // 失敗は何件でも 1 件のトーストにまとめる(挿入は待たない)
    void Promise.allSettled(persisted).then((results) => {
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) toaster.error(MEDIA_PICKER_LABELS.altSaveFailed(failed));
    });
    onSelect(
      selectedItems.map((item) => ({ id: item.id, label: item.filename, alt: altOf(item) })),
    );
  }

  const count = selectedItems.length;
  const L = MEDIA_PICKER_LABELS;

  return (
    <ModalDialog
      title={L.title}
      isOpen
      size="xl"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      footer={
        <>
          <span {...stylex.props(styles.footerHint)}>{L.dropHint}</span>
          <Button variant="secondary" onPress={onClose}>
            {L.cancel}
          </Button>
          <Button variant="primary" isDisabled={count === 0} onPress={insert}>
            {many ? L.insert(count) : L.useOne}
          </Button>
        </>
      }
    >
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.titleRow)}>
          <span {...stylex.props(styles.note)}>{L.fieldNote(fieldName, many)}</span>
          <FileButton
            variant="secondary"
            size="sm"
            icon={Upload}
            allowsMultiple={many}
            onFiles={(files) => void store.start(files)}
          >
            {L.upload}
          </FileButton>
        </div>
        <FileDropTarget hint={MEDIA_LABELS.dropLimit} onFiles={(files) => void store.start(files)}>
          <div {...stylex.props(styles.columns)}>
            <div {...stylex.props(styles.left)}>
              <div {...stylex.props(styles.filters)}>
                <MediaFilterSelect
                  label={MEDIA_LABELS.kindLabel}
                  items={MEDIA_KIND_OPTIONS}
                  selectedValue={kind}
                  onChange={(value) => {
                    if (isMediaKindOrAll(value)) setKind(value);
                  }}
                />
                <div {...stylex.props(styles.search)}>
                  <SearchField
                    label={MEDIA_LABELS.search}
                    placeholder={MEDIA_LABELS.search}
                    value={q}
                    onChange={setQ}
                  />
                </div>
              </div>
              <TileGrid
                label={L.gridLabel}
                size="sm"
                items={visible.map((row) => ({ row, id: row.id, textValue: row.filename }))}
                renderThumb={({ row }) => (
                  <MediaThumb row={row} resolveUrl={assets.resolveUrl} size="tile" />
                )}
                renderBadge={({ row }) => {
                  const index = selectedItems.findIndex((item) => item.id === row.id);
                  if (many && index >= 0) return <Badge tone="accent">{`${index + 1}`}</Badge>;
                  return uploadedIds.has(row.id) ? (
                    <Badge tone="success" icon={Check}>
                      {L.uploaded}
                    </Badge>
                  ) : null;
                }}
                selectionMode={many ? "multiple" : "single"}
                selectedKeys={new Set(orderedIds)}
                onSelectionChange={onSelectionChange}
                leading={uploads.entries
                  .filter((entry) => entry.item.status !== "done")
                  .map((entry) => (
                    <UploadTile
                      key={entry.key}
                      name={entry.item.file.name}
                      state={uploadTileState(entry, {
                        onRetry: () => store.retry(entry.key),
                        onRemove: () => store.remove(entry.key),
                      })}
                    />
                  ))}
              />
            </div>
            <section aria-label={L.selectedRegion} {...stylex.props(styles.right)}>
              <span
                {...stylex.props(styles.count)}
              >{`${L.selected} ${L.selectedCount(count)}`}</span>
              {count === 0 && <p {...stylex.props(styles.none)}>{L.none}</p>}
              {selectedItems.map((item) => {
                const thumbRow = {
                  id: item.id,
                  kind: item.row?.kind ?? item.provisional?.kind ?? "other",
                  extension: item.row?.extension ?? extensionOf(item.filename),
                  alt: altOf(item),
                  filename: item.filename,
                };
                const size = item.row?.size ?? item.provisional?.size ?? 0;
                const dimensions =
                  item.row?.width != null && item.row.height != null
                    ? MEDIA_LABELS.detail.dimensionsOf(item.row.width, item.row.height)
                    : null;
                const justUploaded = item.row === undefined || (!many && uploadedIds.has(item.id));
                const meta = [dimensions, formatBytes(size), justUploaded ? L.justUploaded : null]
                  .filter((part) => part !== null)
                  .join(L.separator);
                return (
                  <div key={item.id} {...stylex.props(styles.item)}>
                    {!many && (
                      <MediaThumb
                        row={thumbRow}
                        resolveUrl={assets.resolveUrl}
                        size="preview"
                        eager
                      />
                    )}
                    <div {...stylex.props(styles.itemHead)}>
                      {many && (
                        <MediaThumb row={thumbRow} resolveUrl={assets.resolveUrl} size="sm" eager />
                      )}
                      <div {...stylex.props(styles.itemText)}>
                        <span {...stylex.props(styles.filename)} title={item.filename}>
                          {item.filename}
                        </span>
                        <span {...stylex.props(styles.meta)}>{meta}</span>
                      </div>
                    </div>
                    {item.row !== undefined && (
                      <TextField
                        label={L.alt}
                        description={L.altHelp}
                        placeholder={L.altPlaceholder}
                        value={altOf(item)}
                        onChange={(value) => setDrafts((prev) => ({ ...prev, [item.id]: value }))}
                        autoFocus={item.id === pendingFocusId}
                      />
                    )}
                  </div>
                );
              })}
            </section>
          </div>
        </FileDropTarget>
      </div>
    </ModalDialog>
  );
}
