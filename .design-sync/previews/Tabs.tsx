import { Badge, EmptyState, Tabs } from "@plyrs/ui";
import { Inbox } from "lucide-react";

const noop = () => {};
// DS は body のフォントを指定しないため、パネルの地の文はアプリ側と同じ書体を当てる
const page = {
  width: 560,
  fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
  fontSize: 14,
} as const;
const list = { display: "flex", flexDirection: "column", gap: 8, padding: "12px 0", margin: 0, listStyle: "none" } as const;
const item = { display: "flex", justifyContent: "space-between", alignItems: "center" } as const;

export const WithCounts = () => (
  <div style={page}>
    <Tabs
      label="公開状態"
      selectedKey="published"
      onSelectionChange={noop}
      items={[
        { id: "all", label: "すべて", count: 24 },
        { id: "published", label: "公開中", count: 18 },
        { id: "changed", label: "未反映の変更あり", count: 3 },
        { id: "archived", label: "アーカイブ", count: 0 },
      ]}
    >
      {() => (
        <ul style={list}>
          <li style={item}>
            年末年始の営業について
            <Badge tone="success" dot>
              公開中
            </Badge>
          </li>
          <li style={item}>
            新しい店舗がオープンします
            <Badge tone="success" dot>
              公開中
            </Badge>
          </li>
        </ul>
      )}
    </Tabs>
  </div>
);

export const EmptyTab = () => (
  <div style={page}>
    <Tabs
      label="公開状態"
      selectedKey="archived"
      onSelectionChange={noop}
      items={[
        { id: "all", label: "すべて", count: 24 },
        { id: "published", label: "公開中", count: 18 },
        { id: "archived", label: "アーカイブ", count: 0 },
      ]}
    >
      {() => (
        <div style={{ paddingTop: 16 }}>
          <EmptyState icon={Inbox} title="アーカイブしたお知らせはありません" size="compact" />
        </div>
      )}
    </Tabs>
  </div>
);
