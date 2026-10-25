import { FileDropTarget, TileGrid } from "@plyrs/ui";
import { FileText, Image } from "lucide-react";

// 暗幕はドラッグ中にしか描けないため、静的には「受け口に包まれた本文」だけを示す
const body = {
  padding: 16,
  fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
  fontSize: 14,
} as const;
const thumb = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: "100%",
  color: "#6b7280",
} as const;

const items = [
  { id: "a", textValue: "cover.png", icon: Image },
  { id: "b", textValue: "menu.pdf", icon: FileText },
  { id: "c", textValue: "hero.jpg", icon: Image },
];

export const WrapsContent = () => (
  <FileDropTarget onFiles={() => {}} hint="1 ファイル 20 MB まで">
    <div style={body}>
      <TileGrid
        label="メディアの一覧"
        items={items}
        renderThumb={(item) => (
          <div style={thumb}>
            <item.icon size={32} strokeWidth={1.5} aria-hidden="true" />
          </div>
        )}
      />
    </div>
  </FileDropTarget>
);
