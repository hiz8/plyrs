import { SegmentedControl } from "@plyrs/ui";
import { LayoutGrid, List, Monitor, Moon, Sun } from "lucide-react";

const col = { display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" } as const;
const noop = () => {};

export const Theme = () => (
  <SegmentedControl
    label="テーマ"
    value="system"
    onChange={noop}
    items={[
      { value: "system", label: "システム", icon: Monitor },
      { value: "light", label: "ライト", icon: Sun },
      { value: "dark", label: "ダーク", icon: Moon },
    ]}
  />
);

export const TwoChoices = () => (
  <div style={col}>
    <SegmentedControl
      label="表示の切り替え"
      value="grid"
      onChange={noop}
      items={[
        { value: "grid", label: "グリッド", icon: LayoutGrid },
        { value: "list", label: "リスト", icon: List },
      ]}
    />
    <SegmentedControl
      label="件数"
      value="one"
      onChange={noop}
      items={[
        { value: "one", label: "1 件だけ" },
        { value: "many", label: "複数" },
      ]}
    />
  </div>
);

export const ReadOnlyAndDisabled = () => (
  <div style={col}>
    <SegmentedControl
      label="件数(読み取り専用)"
      value="many"
      onChange={noop}
      isReadOnly
      items={[
        { value: "one", label: "1 件だけ" },
        { value: "many", label: "複数" },
      ]}
    />
    <SegmentedControl
      label="件数(無効)"
      value="one"
      onChange={noop}
      isDisabled
      items={[
        { value: "one", label: "1 件だけ" },
        { value: "many", label: "複数" },
      ]}
    />
  </div>
);
