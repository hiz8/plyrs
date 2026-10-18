import { useState } from "react";
import { CheckboxGroup } from "@plyrs/ui";

const col = { width: 360 } as const;
const options = [
  { value: "owner", label: "オーナー" },
  { value: "editor", label: "編集者" },
  { value: "reviewer", label: "レビュー担当" },
  { value: "viewer", label: "閲覧者" },
];

function G(props: { initial: string[]; errorMessage?: string; isRequired?: boolean }) {
  const [v, setV] = useState(props.initial);
  return (
    <CheckboxGroup label="対象のロール" options={options} value={v} onChange={setV} errorMessage={props.errorMessage} isRequired={props.isRequired} />
  );
}

export const Default = () => (
  <div style={col}>
    <G initial={["editor", "reviewer"]} />
  </div>
);

export const Required = () => (
  <div style={col}>
    <G initial={[]} isRequired />
  </div>
);

export const Invalid = () => (
  <div style={col}>
    <G initial={[]} isRequired errorMessage="1 つ以上選択してください" />
  </div>
);
