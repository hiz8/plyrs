import * as stylex from "@stylexjs/stylex";
import { Copy } from "lucide-react";
import { Button } from "@plyrs/ui";
import { border, font, radius, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import { copyText } from "../../lib/clipboard";
import { CLIPBOARD_LABELS, SETTINGS_LABELS } from "../../lib/labels";

const styles = stylex.create({
  field: { display: "flex", flexDirection: "column", gap: space.xs, minWidth: 0 },
  label: { fontSize: font.body, fontWeight: font.weightMedium, color: text.default },
  row: { display: "flex", alignItems: "center", gap: space.sm, minWidth: 0 },
  code: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    paddingBlock: space.xs,
    paddingInline: space.sm,
    fontFamily: font.familyMono,
    fontSize: font.caption,
    color: text.default,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.item,
  },
  help: { fontSize: font.caption, color: text.muted },
});

export function CopyField({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div {...stylex.props(styles.field)}>
      <span {...stylex.props(styles.label)}>{label}</span>
      <div {...stylex.props(styles.row)}>
        <code {...stylex.props(styles.code)}>{value}</code>
        <Button
          variant="secondary"
          size="sm"
          icon={Copy}
          aria-label={CLIPBOARD_LABELS.copyOf(label)}
          onPress={() => void copyText(value)}
        >
          {SETTINGS_LABELS.publicApi.copy}
        </Button>
      </div>
      {help === undefined ? null : <span {...stylex.props(styles.help)}>{help}</span>}
    </div>
  );
}
