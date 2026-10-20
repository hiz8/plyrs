import { Monitor, Moon, Sun } from "lucide-react";
import { SegmentedControl } from "@plyrs/ui";
import { ACCOUNT_LABELS } from "../lib/labels";
import { type ThemePreference, useThemePreference } from "../lib/theme";

// h-design-tokens.md 4 章の切り替え。置き場所はアカウント設定(案 G 6.2)
const labels = ACCOUNT_LABELS.theme;
const ITEMS = [
  { value: "system", label: labels.system, icon: Monitor },
  { value: "light", label: labels.light, icon: Sun },
  { value: "dark", label: labels.dark, icon: Moon },
];

export function ThemeSegment() {
  const [preference, setPreference] = useThemePreference();
  return (
    <SegmentedControl
      label={labels.label}
      items={ITEMS}
      value={preference}
      onChange={(value) => setPreference(value as ThemePreference)}
    />
  );
}
