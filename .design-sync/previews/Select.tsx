import { useState } from "react";
import { Select } from "@plyrs/ui";

const col = { display: "flex", flexDirection: "column", gap: 16, width: 320 } as const;
const items = [
  { value: "draft", label: "下書き" },
  { value: "review", label: "レビュー中" },
  { value: "ready", label: "公開準備完了" },
  { value: "archived", label: "アーカイブ" },
];

function Field(props: { initial?: string; isDisabled?: boolean; errorMessage?: string; label: string }) {
  const [v, setV] = useState(props.initial ?? "");
  return (
    <Select
      label={props.label}
      items={items}
      selectedValue={v}
      onChange={setV}
      placeholder="選択してください"
      isDisabled={props.isDisabled}
      errorMessage={props.errorMessage}
    />
  );
}

export const Selected = () => (
  <div style={col}>
    <Field label="ステータス" initial="review" />
  </div>
);

export const Placeholder = () => (
  <div style={col}>
    <Field label="ステータス" />
  </div>
);

export const Invalid = () => (
  <div style={col}>
    <Field label="ステータス" errorMessage="ステータスを選択してください" />
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <Field label="ステータス" initial="archived" isDisabled />
  </div>
);
