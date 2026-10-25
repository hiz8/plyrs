import { Drawer } from "@plyrs/ui";
import { House, Image, LayoutGrid, Settings } from "lucide-react";

// DS は body のフォントを指定しないため、ドロワーの中の地の文はアプリ側と同じ書体を当てる
const nav = {
  width: 240,
  padding: 16,
  fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
  fontSize: 14,
  display: "flex",
  flexDirection: "column",
  gap: 4,
} as const;
const item = { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 6 } as const;
const current = { ...item, background: "#eef2ff", fontWeight: 600 } as const;

export const Open = () => (
  <Drawer isOpen onOpenChange={() => {}} label="メニュー">
    <nav style={nav}>
      <a style={current}>
        <House size={16} aria-hidden="true" /> ホーム
      </a>
      <a style={item}>
        <LayoutGrid size={16} aria-hidden="true" /> お知らせ
      </a>
      <a style={item}>
        <Image size={16} aria-hidden="true" /> メディア
      </a>
      <a style={item}>
        <Settings size={16} aria-hidden="true" /> 設定
      </a>
    </nav>
  </Drawer>
);
