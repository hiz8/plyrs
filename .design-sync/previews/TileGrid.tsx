import { Badge, TileGrid, UploadTile } from "@plyrs/ui";
import { FileText, Film, Image } from "lucide-react";

// サムネイルは画像の代わりに種類のアイコンと拡張子で描く(撮影環境に画像が無いため)
const thumb = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  width: "100%",
  height: "100%",
  color: "#6b7280",
} as const;
const ext = {
  fontSize: 11,
  fontWeight: 700,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  padding: "1px 6px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  background: "#fff",
} as const;
const noop = () => {};

const items = [
  { id: "a", textValue: "autumn-campaign.jpg", icon: Image, ext: "JPG", unused: false },
  { id: "b", textValue: "menu-2026.pdf", icon: FileText, ext: "PDF", unused: true },
  { id: "c", textValue: "store-tour.mp4", icon: Film, ext: "MP4", unused: false },
  { id: "d", textValue: "logo.png", icon: Image, ext: "PNG", unused: false },
];

const renderThumb = (item: (typeof items)[number]) => (
  <div style={thumb}>
    <item.icon size={32} strokeWidth={1.5} aria-hidden="true" />
    <span style={ext}>{item.ext}</span>
  </div>
);

export const Selectable = () => (
  <TileGrid
    label="メディアの一覧"
    items={items}
    renderThumb={renderThumb}
    renderBadge={(item) => (item.unused ? <Badge tone="warning">未使用</Badge> : undefined)}
    selectionMode="multiple"
    selectedKeys={new Set(["a"])}
    onSelectionChange={noop}
    onAction={noop}
  />
);

export const WithUploads = () => (
  <TileGrid
    label="メディアの一覧"
    items={items.slice(0, 2)}
    renderThumb={renderThumb}
    leading={
      <>
        <UploadTile name="photo-01.jpg" state={{ kind: "uploading", progress: 0.64, detail: "64% ・ 1.2 MB / 1.9 MB" }} />
        <UploadTile name="photo-02.jpg" state={{ kind: "queued" }} />
      </>
    }
  />
);

export const SmallSingle = () => (
  <TileGrid
    label="ファイル"
    items={items}
    renderThumb={renderThumb}
    renderBadge={(item) => (item.id === "c" ? <Badge tone="accent">1</Badge> : undefined)}
    selectionMode="single"
    selectedKeys={new Set(["c"])}
    onSelectionChange={noop}
    size="sm"
  />
);
