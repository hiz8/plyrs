import { Badge, SortableList } from "@plyrs/ui";

// DS は body のフォントを指定しないため、行の地の文はアプリ側と同じ書体を当てる
const page = {
  width: 520,
  fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
  fontSize: 14,
} as const;
const row = { display: "flex", alignItems: "center", gap: 12, width: "100%" } as const;
const name = { fontWeight: 600 } as const;
const key = { color: "#6b7280", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 } as const;
const spacer = { marginInlineStart: "auto" } as const;
const noop = () => {};

const fields = [
  { id: "title", textValue: "タイトル", key: "title", kind: "テキスト(1 行)", required: true },
  { id: "body", textValue: "本文", key: "body", kind: "リッチテキスト", required: false },
  { id: "published_at", textValue: "公開日", key: "published_at", kind: "日時", required: false },
  { id: "hero", textValue: "アイキャッチ", key: "hero", kind: "画像・ファイル", required: false },
];

const renderField = (item: (typeof fields)[number]) => (
  <div style={row}>
    <span style={name}>{item.textValue}</span>
    <span style={key}>{item.key}</span>
    <span style={spacer}>
      <Badge tone={item.required ? "accent" : "neutral"}>{item.required ? "必須" : item.kind}</Badge>
    </span>
  </div>
);

export const Fields = () => (
  <div style={page}>
    <SortableList
      label="フィールドの並び"
      items={fields}
      renderItem={renderField}
      dragLabel={(item) => `${item.textValue}を並べ替え`}
      onReorder={noop}
      rowHeight="tall"
    />
  </div>
);

export const ReadOnly = () => (
  <div style={page}>
    <SortableList
      label="フィールドの並び(モジュールの型)"
      items={fields.slice(0, 3)}
      renderItem={renderField}
      dragLabel={(item) => `${item.textValue}を並べ替え`}
      onReorder={noop}
      isDisabled
    />
  </div>
);
