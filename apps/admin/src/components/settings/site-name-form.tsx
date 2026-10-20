import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button, TextField } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { SETTINGS_LABELS } from "../../lib/labels";
import { SettingsCard } from "./settings-card";

const NARROW = "@media (max-width: 959px)";
const MAX_NAME_LENGTH = 100;

const styles = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: { default: "repeat(2, minmax(0, 1fr))", [NARROW]: "minmax(0, 1fr)" },
    gap: space.lg,
  },
  slug: { display: "flex", flexDirection: "column", gap: space.xs, minWidth: 0 },
  slugLabel: { fontSize: font.body, fontWeight: font.weightMedium, color: text.default },
  slugValue: { fontFamily: font.familyMono, fontSize: font.body, color: text.default },
  help: { fontSize: font.caption, color: text.muted },
});

export function SiteNameForm({
  name,
  slug,
  onSave,
  isPending,
}: {
  name: string;
  slug: string;
  onSave: (name: string) => Promise<void>;
  isPending: boolean;
}) {
  const labels = SETTINGS_LABELS.site;
  const [value, setValue] = useState(name);
  const trimmed = value.trim();
  const empty = trimmed === "";
  const tooLong = trimmed.length > MAX_NAME_LENGTH;
  const invalid = empty || tooLong;
  const cannotSave = invalid || trimmed === name || isPending;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!cannotSave) {
          void onSave(trimmed);
        }
      }}
    >
      <SettingsCard
        title={labels.title}
        footer={
          <Button type="submit" variant="primary" isDisabled={cannotSave}>
            {labels.save}
          </Button>
        }
      >
        <div {...stylex.props(styles.grid)}>
          <TextField
            label={labels.name}
            description={labels.nameHelp}
            value={value}
            onChange={setValue}
            isInvalid={invalid}
            errorMessage={empty ? labels.nameRequired : labels.nameTooLong}
          />
          <div {...stylex.props(styles.slug)}>
            <span {...stylex.props(styles.slugLabel)}>{labels.slug}</span>
            <span {...stylex.props(styles.slugValue)}>{slug}</span>
            <span {...stylex.props(styles.help)}>{labels.slugHelp}</span>
          </div>
        </div>
      </SettingsCard>
    </form>
  );
}
