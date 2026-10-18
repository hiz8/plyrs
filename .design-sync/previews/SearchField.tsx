import { useState } from "react";
import { SearchField } from "@plyrs/ui";

const col = { width: 360 } as const;

function S(props: { initial?: string }) {
  const [v, setV] = useState(props.initial ?? "");
  return <SearchField label="お知らせを検索" value={v} onChange={setV} placeholder="タイトルで検索" />;
}

export const Empty = () => (
  <div style={col}>
    <S />
  </div>
);

export const WithValue = () => (
  <div style={col}>
    <S initial="年末年始" />
  </div>
);
