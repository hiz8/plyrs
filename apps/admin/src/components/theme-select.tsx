import { Select } from "@plyrs/ui";
import { type ThemePreference, useThemePreference } from "../lib/theme";

// h-design-tokens.md 4 章の切り替え。置き場所はアカウント設定(案 G 6.2、V4 で配置する)
const ITEMS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "自動(OS の設定に従う)" },
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
];

export function ThemeSelect() {
  const [preference, setPreference] = useThemePreference();
  return (
    <Select
      label="テーマ"
      items={ITEMS}
      selectedValue={preference}
      onChange={(value) => setPreference(value as ThemePreference)}
    />
  );
}
