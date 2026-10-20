import * as stylex from "@stylexjs/stylex";
import { X } from "lucide-react";
import { LIST_COLUMNS_MAX } from "@plyrs/metamodel";
import { Badge, IconButton } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { CONTENT_TYPE_LABELS } from "../../lib/labels";
import { ListColumnsSelect } from "./list-columns-select";

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: space.sm, fontFamily: font.family },
  heading: { display: "flex", alignItems: "baseline", gap: space.sm },
  title: { fontSize: font.body, fontWeight: font.weightMedium, color: text.default },
  caption: { fontSize: font.caption, color: text.muted },
  chips: { display: "flex", flexWrap: "wrap", gap: space.sm },
  chip: { display: "inline-flex", alignItems: "center", gap: space.xs },
});

// E20: 一覧に出す列。選択中はチップ、追加はセレクト(3 件で無効)
export function ListColumnsPicker({
  fields,
  value,
  onChange,
  isReadOnly,
}: {
  fields: readonly { key: string; label: string }[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  isReadOnly: boolean;
}) {
  const labels = CONTENT_TYPE_LABELS.editor;
  const selected = value.flatMap((key) => fields.filter((field) => field.key === key));
  const candidates = fields
    .filter((field) => !value.includes(field.key))
    .map((field) => ({ value: field.key, label: field.label }));
  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.heading)}>
        <span {...stylex.props(styles.title)}>{labels.listColumns}</span>
        <span {...stylex.props(styles.caption)}>{labels.listColumnsMax(LIST_COLUMNS_MAX)}</span>
      </div>
      {selected.length === 0 ? null : (
        <div {...stylex.props(styles.chips)}>
          {selected.map((field) => (
            <Badge key={field.key} tone="accent">
              <span {...stylex.props(styles.chip)}>
                {field.label}
                {isReadOnly ? null : (
                  <IconButton
                    icon={X}
                    size="sm"
                    label={labels.removeColumn(field.label)}
                    onPress={() => onChange(value.filter((key) => key !== field.key))}
                  />
                )}
              </span>
            </Badge>
          ))}
        </div>
      )}
      <ListColumnsSelect
        label={labels.addColumn}
        items={candidates}
        isDisabled={value.length >= LIST_COLUMNS_MAX || isReadOnly}
        onChange={(key) => onChange([...value, key])}
      />
      <span {...stylex.props(styles.caption)}>{labels.listColumnsHelp}</span>
    </div>
  );
}
