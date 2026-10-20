import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ContentTypeDefinition, FieldDefinition } from "@plyrs/metamodel";
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import type { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import { Button, ModalDialog } from "@plyrs/ui";
import { bg, border, font, radius, space, status, stroke, text } from "@plyrs/ui/semantic.stylex";
import type { AssetServices } from "../lib/asset-services";
import { ASSET_PICKER_LABELS } from "../lib/labels";
import { labelForRecord } from "../lib/record-label";
import { parseRelationDraftKey, relationDraftKey } from "../lib/record-form-values";
import { useRelationCandidates } from "../lib/use-collection";
import { AssetThumb } from "./asset-thumb";

const styles = stylex.create({
  content: { display: "flex", flexDirection: "column", gap: space.sm },
  grid: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    maxHeight: "280px",
    overflowY: "auto",
  },
  candidate: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    padding: space.xs,
    borderRadius: radius.control,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    backgroundColor: bg.canvas,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
  },
  muted: { color: text.muted, fontSize: font.caption },
  error: { color: status.danger, fontSize: font.caption },
  fieldLabel: { fontSize: font.caption, color: text.muted },
  selected: { display: "flex", flexDirection: "column", gap: space.xs },
  selectedRow: { display: "flex", alignItems: "center", gap: space.sm },
  actions: { display: "flex", gap: space.sm, alignItems: "center" },
});

export interface AssetSelectItem {
  id: string;
  label: string;
}

// アセット選択ダイアログ。関係フィールド(AssetRelationPicker)と本文画像挿入(RecordForm)が
// 共用する。候補は同期済み asset コレクション — アップロード直後の WS 反映前でも選択できる
// よう、アップロード成功時は filename を label にして即確定する。
export function AssetSelectDialog({
  registry,
  types,
  assets,
  onSelect,
  onClose,
}: {
  registry: CollectionRegistry;
  types: ContentTypeDefinition[];
  assets: AssetServices;
  onSelect: (item: AssetSelectItem) => void;
  onClose: () => void;
}) {
  const candidates = useRelationCandidates(registry, [ASSET_TYPE_KEY]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (file === undefined) {
      return;
    }
    setError(null);
    try {
      const { id } = await assets.upload(file);
      onSelect({ id, label: file.name });
    } catch {
      setError("アップロードに失敗しました。");
    } finally {
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <ModalDialog
      title={ASSET_PICKER_LABELS.selectTitle}
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      footer={
        <Button variant="secondary" onPress={onClose}>
          閉じる
        </Button>
      }
    >
      <div {...stylex.props(styles.content)}>
        <input
          ref={fileInputRef}
          type="file"
          aria-label="新しいアセットをアップロード"
          onChange={(event) => void upload(event.currentTarget.files)}
        />
        {error !== null && <span {...stylex.props(styles.error)}>{error}</span>}
        {candidates.length === 0 ? (
          <p {...stylex.props(styles.muted)}>
            アセットがまだありません。アップロードしてください。
          </p>
        ) : (
          <div {...stylex.props(styles.grid)}>
            {candidates.map((candidate) => {
              const label = labelForRecord(types, candidate);
              return (
                <button
                  key={candidate.id}
                  type="button"
                  {...stylex.props(styles.candidate)}
                  onClick={() => onSelect({ id: candidate.id, label })}
                >
                  <AssetThumb record={candidate} resolveUrl={assets.resolveUrl} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </ModalDialog>
  );
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
  const candidates = useRelationCandidates(registry, [ASSET_TYPE_KEY]);
  const many = field.config.cardinality === "many";
  const selectedKeys: string[] = many
    ? Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : []
    : typeof value === "string" && value !== ""
      ? [value]
      : [];

  function select(item: AssetSelectItem) {
    const key = relationDraftKey({ type: ASSET_TYPE_KEY, id: item.id });
    if (many) {
      if (!selectedKeys.includes(key)) {
        onChange([...selectedKeys, key]);
      }
    } else {
      onChange(key);
    }
    setOpen(false);
  }

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
            {record !== undefined && <AssetThumb record={record} resolveUrl={assets.resolveUrl} />}
            <span>
              {record === undefined ? (ref?.id.slice(0, 8) ?? key) : labelForRecord(types, record)}
            </span>
            <Button variant="secondary" onPress={() => remove(key)}>
              解除
            </Button>
          </div>
        );
      })}
      <div {...stylex.props(styles.actions)}>
        <Button variant="secondary" onPress={() => setOpen(true)}>
          アセットを選択
        </Button>
      </div>
      {open && (
        <AssetSelectDialog
          registry={registry}
          types={types}
          assets={assets}
          onSelect={select}
          onClose={() => setOpen(false)}
        />
      )}
      {error !== undefined && <span {...stylex.props(styles.error)}>{error}</span>}
    </div>
  );
}
