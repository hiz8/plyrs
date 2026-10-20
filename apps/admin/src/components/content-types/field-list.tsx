import * as stylex from "@stylexjs/stylex";
import { TriangleAlert } from "lucide-react";
import type { FieldDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { Badge, Button, SortableList } from "@plyrs/ui";
import { accent, bg, border, font, radius, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import {
  countEmpty,
  countFilled,
  fieldChange,
  fieldTags,
  type FieldDraft,
} from "../../lib/content-type-form";
import { CONTENT_TYPE_LABELS, FIELD_KIND_LABELS } from "../../lib/labels";
import { DialogNote } from "../settings/dialog-note";

const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  frame: {
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    overflow: "hidden",
    backgroundColor: bg.canvas,
    fontFamily: font.family,
  },
  cell: { display: "flex", flexDirection: "column", gap: space.sm, width: "100%" },
  editing: { backgroundColor: accent.surface },
  row: {
    display: "flex",
    flexWrap: { default: "nowrap", [NARROW]: "wrap" },
    alignItems: "center",
    gap: space.sm,
    width: "100%",
  },
  names: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 },
  label: {
    fontWeight: font.weightMedium,
    color: text.default,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  key: { fontSize: font.caption, fontFamily: font.familyMono, color: text.muted },
  // 種類の列幅は、この一覧だけの部品固有の寸法(案 E 5.2)
  kind: { width: "130px", fontSize: font.caption, color: text.muted },
  tags: { display: "flex", flexWrap: "wrap", gap: space.xs },
});

export interface FieldListProps {
  drafts: readonly FieldDraft[];
  /** 保存済みの定義(変更の検出) */
  original: readonly FieldDefinition[];
  /** null = 同期前(件数なし) */
  records: readonly SyncRecord[] | null;
  titleKey: string | null;
  editingKey: string | null;
  isReadOnly: boolean;
  /** trigger はフォーカスの戻し先 */
  onEdit: (key: string, trigger: HTMLElement) => void;
  onReorder: (orderedKeys: string[]) => void;
}

// 案 E 5.2(E18): フィールドの行。変更があれば行の下に件数つきの注意を出す
export function FieldList({
  drafts,
  original,
  records,
  titleKey,
  editingKey,
  isReadOnly,
  onEdit,
  onReorder,
}: FieldListProps) {
  const labels = CONTENT_TYPE_LABELS;
  const editor = labels.editor;
  const items = drafts.map((draft) => ({
    id: draft.key,
    textValue: draft.label === "" ? draft.key : draft.label,
    draft,
  }));
  return (
    <div {...stylex.props(styles.frame)}>
      <SortableList
        label={editor.fields}
        items={items}
        rowHeight="tall"
        isDisabled={isReadOnly}
        dragLabel={(item) => labels.dragLabel(item.textValue)}
        onReorder={onReorder}
        renderItem={({ draft, textValue }) => {
          const change = fieldChange(
            original.find((field) => field.key === draft.key),
            draft,
          );
          const tags = fieldTags(draft, titleKey, change);
          const isEditing = editingKey === draft.key;
          const kindName = FIELD_KIND_LABELS[draft.kind].name;
          const warnTags: readonly string[] = [
            labels.tags.requiredChanged,
            labels.tags.kindChanged,
          ];
          return (
            <div {...stylex.props(styles.cell, isEditing && styles.editing)}>
              <div {...stylex.props(styles.row)}>
                <div {...stylex.props(styles.names)}>
                  <span {...stylex.props(styles.label)}>{textValue}</span>
                  <span {...stylex.props(styles.key)}>{draft.key}</span>
                </div>
                <span {...stylex.props(styles.kind)}>
                  {change.kindChanged === null
                    ? kindName
                    : `${FIELD_KIND_LABELS[change.kindChanged.from].name}${labels.kindChangeArrow}${kindName}`}
                </span>
                <div {...stylex.props(styles.tags)}>
                  {tags.map((tag) => (
                    <Badge
                      key={tag}
                      tone={
                        warnTags.includes(tag)
                          ? "warning"
                          : tag === labels.tags.title
                            ? "accent"
                            : "neutral"
                      }
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
                <Button
                  variant={isEditing ? "primary" : "secondary"}
                  size="sm"
                  aria-expanded={isEditing}
                  onPress={(event) => {
                    if (event.target instanceof HTMLElement) onEdit(draft.key, event.target);
                  }}
                >
                  {isEditing
                    ? editor.editingField
                    : isReadOnly
                      ? editor.viewField
                      : editor.editField}
                </Button>
              </div>
              {change.requiredAdded ? (
                <DialogNote tone="warning" icon={TriangleAlert}>
                  {labels.warnings.requiredAdded(
                    records === null ? null : countEmpty(records, draft.key),
                  )}
                </DialogNote>
              ) : null}
              {change.kindChanged === null ? null : (
                <DialogNote tone="warning" icon={TriangleAlert}>
                  {labels.warnings.kindChanged(
                    records === null ? null : countFilled(records, draft.key),
                  )}
                </DialogNote>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
