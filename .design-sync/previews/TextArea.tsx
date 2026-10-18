import { useState } from "react";
import { TextArea } from "@plyrs/ui";

const col = { display: "flex", flexDirection: "column", gap: 16, width: 400 } as const;

function Field(props: { label: string; initial?: string; [k: string]: unknown }) {
  const { initial = "", ...rest } = props;
  const [v, setV] = useState(initial);
  return <TextArea label={props.label} value={v} onChange={setV} {...rest} />;
}

export const Default = () => (
  <div style={col}>
    <Field label="概要" initial="年末年始の営業時間についてお知らせします。12月29日から1月3日まで休業いたします。" rows={4} />
  </div>
);

export const Required = () => (
  <div style={col}>
    <Field label="本文の要約" isRequired rows={3} />
  </div>
);

export const Invalid = () => (
  <div style={col}>
    <Field label="概要" isRequired isInvalid errorMessage="概要を入力してください" rows={3} />
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <Field label="概要" initial="アーカイブ済みのため編集できません" isDisabled rows={3} />
  </div>
);
