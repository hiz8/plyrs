import { useState } from "react";
import { Checkbox } from "@plyrs/ui";

const col = { display: "flex", flexDirection: "column", gap: 12 } as const;

function C(props: { initial?: boolean; children: string; isDisabled?: boolean; isIndeterminate?: boolean; isInvalid?: boolean }) {
  const { initial = false, ...rest } = props;
  const [s, setS] = useState(initial);
  return <Checkbox isSelected={s} onChange={setS} {...rest} />;
}

export const States = () => (
  <div style={col}>
    <C>トップページに固定する</C>
    <C initial>公開時にメンバーへ通知する</C>
    <C isIndeterminate>すべてのお知らせを選択</C>
  </div>
);

export const Invalid = () => (
  <div style={col}>
    <C isInvalid>利用規約に同意する</C>
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <C isDisabled>公開時にメンバーへ通知する</C>
    <C initial isDisabled>トップページに固定する</C>
  </div>
);
