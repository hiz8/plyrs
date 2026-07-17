import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ContentTypeDefinition, FieldDefinition } from "@plyrs/metamodel";
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import type { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import type { AssetServices } from "../lib/asset-services";
import { parseRelationDraftKey, relationDraftKey } from "../lib/record-form-values";
import { useRelationCandidates } from "../lib/use-collection";
import { AssetThumb } from "./asset-thumb";
import { labelForRecord } from "./record-form";

const styles = stylex.create({
  dialog: {
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    maxWidth: "480px",
  },
  dialogTitle: { fontSize: typography.sizeMd, fontWeight: 600, margin: 0 },
  grid: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    maxHeight: "280px",
    overflowY: "auto",
  },
  candidate: {
    display: "flex",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.xs,
    borderRadius: "4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.bg,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: typography.fontFamily,
    fontSize: typography.sizeMd,
    color: colors.text,
  },
  muted: { color: colors.textMuted, fontSize: typography.sizeSm },
  error: { color: colors.danger, fontSize: typography.sizeSm },
  fieldLabel: { fontSize: typography.sizeSm, color: colors.textMuted },
  selected: { display: "flex", flexDirection: "column", gap: spacing.xs },
  selectedRow: { display: "flex", alignItems: "center", gap: spacing.sm },
  actions: { display: "flex", gap: spacing.sm, alignItems: "center" },
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
    <div role="dialog" aria-label="アセットを選択" {...stylex.props(styles.dialog)}>
      <h2 {...stylex.props(styles.dialogTitle)}>アセットを選択</h2>
      <input
        ref={fileInputRef}
        type="file"
        aria-label="新しいアセットをアップロード"
        onChange={(event) => void upload(event.currentTarget.files)}
      />
      {error !== null && <span {...stylex.props(styles.error)}>{error}</span>}
      {candidates.length === 0 ? (
        <p {...stylex.props(styles.muted)}>アセットがまだありません。アップロードしてください。</p>
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
      <div {...stylex.props(styles.actions)}>
        <Button variant="secondary" onPress={onClose}>
          閉じる
        </Button>
      </div>
    </div>
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
}: {
  field: Extract<FieldDefinition, { type: "relation" }>;
  value: unknown;
  onChange: (next: unknown) => void;
  error: string | undefined;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
  assets: AssetServices;
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

  return (
    <div {...stylex.props(styles.selected)}>
      <span {...stylex.props(styles.fieldLabel)}>{field.key}</span>
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
