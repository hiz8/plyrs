import { useState } from "react";
import { RichTextEditor, type RichTextValue } from "@plyrs/ui";

const wrap = { width: 640 } as const;

const doc = (paras: string[]): RichTextValue => ({
  schemaVersion: 1,
  doc: {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "年末年始の営業について" }] },
      ...paras.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
    ],
  },
} as RichTextValue);

function E(props: { initial?: RichTextValue; errorMessage?: string }) {
  const [v, setV] = useState<RichTextValue | undefined>(props.initial);
  return <RichTextEditor label="本文" value={v} onChange={setV} errorMessage={props.errorMessage} />;
}

export const WithContent = () => (
  <div style={wrap}>
    <E initial={doc(["12月29日から1月3日まで休業いたします。", "ご不便をおかけしますが、よろしくお願いいたします。"])} />
  </div>
);

export const Empty = () => (
  <div style={wrap}>
    <E />
  </div>
);

export const Invalid = () => (
  <div style={wrap}>
    <E errorMessage="本文を入力してください" />
  </div>
);
