import * as stylex from "@stylexjs/stylex";
import { useMemo, useState } from "react";
import type { ContentTypeDefinition, FieldDefinition } from "@plyrs/metamodel";
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import type { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { Button } from "@plyrs/ui";
import { font, space, status, text } from "@plyrs/ui/semantic.stylex";
import type { AssetServices } from "../lib/asset-services";
import { MEDIA_LABELS, MEDIA_PICKER_LABELS } from "../lib/labels";
import { labelForRecord } from "../lib/record-label";
import { parseRelationDraftKey, relationDraftKey } from "../lib/record-form-values";
import { useRecordsOfTypes } from "../lib/use-collection";
import { buildMediaRows } from "../lib/media-list";
import { MediaThumb } from "./media/media-thumb";
import { MediaPickerDialog, type PickedMedia } from "./media/media-picker-dialog";

const styles = stylex.create({
  error: { color: status.danger, fontSize: font.caption },
  fieldLabel: { fontSize: font.caption, color: text.muted },
  selected: { display: "flex", flexDirection: "column", gap: space.xs },
  selectedRow: { display: "flex", alignItems: "center", gap: space.sm },
  filename: { fontFamily: font.familyMono, fontSize: font.caption },
  actions: { display: "flex", gap: space.sm, alignItems: "center" },
});

// 選択中の表示用の小さなサムネイル(MediaThumb xs)
function RecordThumb({
  record,
  resolveUrl,
}: {
  record: SyncRecord;
  resolveUrl: AssetServices["resolveUrl"];
}) {
  const row = buildMediaRows([record])[0];
  return row === undefined ? null : <MediaThumb row={row} resolveUrl={resolveUrl} size="xs" />;
}

// allowedTypes がちょうど ["asset"] の関係フィールド向けの置き換え UI(Phase 8 裁定:
// メディアフィールドは独立型ではなく asset への関係フィールド — design-spec §5 論点E)。
export function AssetRelationPicker({
  field,
  value,
  onChange,
  error,
  types,
  registry,
  assets,
  isReadOnly,
}: {
  field: Extract<FieldDefinition, { type: "relation" }>;
  value: unknown;
  onChange: (next: unknown) => void;
  error: string | undefined;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
  assets: AssetServices;
  /** 閲覧者向け。ラベルと選択中の名前の文字だけを描く */
  isReadOnly?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  // types に asset 型が無いテナントでは購読しない(MediaPickerDialog と同じ規則)
  const assetTypeKeys = useMemo(
    () => (types.some((type) => type.key === ASSET_TYPE_KEY) ? [ASSET_TYPE_KEY] : []),
    [types],
  );
  const candidates = useRecordsOfTypes(registry, assetTypeKeys);
  const many = field.config.cardinality === "many";
  const selectedKeys: string[] = many
    ? Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : []
    : typeof value === "string" && value !== ""
      ? [value]
      : [];

  // F31(2026-10-24 改定): many はダイアログで確定した選択の順で値を置き換える(外した id は値からも外れるが、レコードの無い dangling な id は末尾に保つ)。
  // one も置き換え。閉じるのはここ
  function select(items: PickedMedia[]) {
    const keys = items.map((item) => relationDraftKey({ type: ASSET_TYPE_KEY, id: item.id }));
    if (many) {
      // レコードが手元に無い id(dangling)は正常系。値から黙って落とさず末尾に保つ
      const known = new Set(candidates.map((candidate) => candidate.id));
      const dangling = selectedKeys.filter((key) => {
        const id = parseRelationDraftKey(key)?.id;
        return id !== undefined && !known.has(id);
      });
      onChange([...keys, ...dangling.filter((key) => !keys.includes(key))]);
    } else if (keys[0] !== undefined) {
      onChange(keys[0]);
    }
    setOpen(false);
  }

  const selectedIds = selectedKeys.flatMap((key) => parseRelationDraftKey(key)?.id ?? []);

  function remove(key: string) {
    if (many) {
      onChange(selectedKeys.filter((entry) => entry !== key));
    } else {
      onChange("");
    }
  }

  const fieldName = field.label ?? field.key;

  if (isReadOnly === true) {
    return (
      <div {...stylex.props(styles.selected)}>
        <span {...stylex.props(styles.fieldLabel)}>{fieldName}</span>
        {selectedKeys.map((key) => {
          const ref = parseRelationDraftKey(key);
          const record = candidates.find((candidate) => candidate.id === ref?.id);
          return (
            <span key={key}>
              {record === undefined ? (ref?.id.slice(0, 8) ?? key) : labelForRecord(types, record)}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.selected)}>
      <span {...stylex.props(styles.fieldLabel)}>{fieldName}</span>
      {selectedKeys.map((key) => {
        const ref = parseRelationDraftKey(key);
        const record = candidates.find((candidate) => candidate.id === ref?.id);
        return (
          <div key={key} {...stylex.props(styles.selectedRow)}>
            {record !== undefined && <RecordThumb record={record} resolveUrl={assets.resolveUrl} />}
            <span {...stylex.props(styles.filename)}>
              {record === undefined ? (ref?.id.slice(0, 8) ?? key) : labelForRecord(types, record)}
            </span>
            <Button variant="secondary" onPress={() => remove(key)}>
              {MEDIA_LABELS.remove}
            </Button>
          </div>
        );
      })}
      <div {...stylex.props(styles.actions)}>
        <Button variant="secondary" onPress={() => setOpen(true)}>
          {MEDIA_PICKER_LABELS.title}
        </Button>
      </div>
      {open && (
        <MediaPickerDialog
          registry={registry}
          types={types}
          assets={assets}
          fieldName={fieldName}
          selection={many ? "many" : "one"}
          defaultKind="all"
          initialIds={selectedIds}
          onSelect={select}
          onClose={() => setOpen(false)}
        />
      )}
      {error !== undefined && <span {...stylex.props(styles.error)}>{error}</span>}
    </div>
  );
}
