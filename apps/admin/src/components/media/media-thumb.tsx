import * as stylex from "@stylexjs/stylex";
import { ICON_SIZE, ICON_STROKE } from "@plyrs/ui";
import { bg, border, font, radius, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import { File, FileText, Film, Image, Music, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MediaKind, MediaRow } from "../../lib/media-list";

// F18: 一覧の寸法は部品の size で決める(tile は TileGrid の枠いっぱい)
const styles = stylex.create({
  tile: { width: "100%", height: "100%", aspectRatio: "1" },
  // F20: 56px(選択中欄)
  sm: { width: "56px", height: "56px" },
  // F20: リストのサムネイル 40px
  xs: { width: "40px", height: "40px" },
  // F4 章: プレビュー高さ 200px
  preview: { width: "100%", height: "200px" },
  frame: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
    boxSizing: "border-box",
    overflow: "hidden",
    backgroundColor: bg.surface,
    color: text.muted,
    borderRadius: radius.control,
  },
  image: { display: "block", width: "100%", height: "100%", objectFit: "cover" },
  contain: { objectFit: "contain" },
  tag: {
    fontSize: font.caption,
    fontWeight: font.weightBold,
    fontFamily: font.familyMono,
    color: text.muted,
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.small,
    // 部品固有の余白(縦 1px)
    padding: `1px ${space.sm}`,
  },
  tagPlain: { fontSize: font.caption, fontFamily: font.familyMono, color: text.muted },
});

const KIND_ICONS: Record<MediaKind, LucideIcon> = {
  image: Image,
  pdf: FileText,
  video: Film,
  audio: Music,
  other: File,
};

export function kindIcon(kind: MediaKind): LucideIcon {
  return KIND_ICONS[kind];
}

export interface MediaThumbProps {
  row: Pick<MediaRow, "id" | "kind" | "extension" | "alt" | "filename">;
  resolveUrl: (assetId: string) => Promise<string | null>;
  /** tile = 幅 100%・aspectRatio 1(TileGrid の中)、sm = 56px、xs = 40px、preview = 幅 100%・高さ 200px */
  size: "tile" | "sm" | "xs" | "preview";
  /** true: 画面に入るのを待たずに読む(パネルのプレビュー・選択中欄) */
  eager?: boolean;
}

// 一度画面に入ったら true のまま(観測をやめる)。IntersectionObserver が無い環境(jsdom)は最初から true
function useVisible(ref: React.RefObject<HTMLElement | null>, eager: boolean): boolean {
  const [visible, setVisible] = useState(
    () =>
      eager || typeof window === "undefined" || typeof window.IntersectionObserver !== "function",
  );
  useEffect(() => {
    const node = ref.current;
    if (visible || node === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, visible]);
  return visible;
}

export function MediaThumb({ row, resolveUrl, size, eager = false }: MediaThumbProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isImage = row.kind === "image";
  const visible = useVisible(ref, eager);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage || !visible) return;
    let cancelled = false;
    void resolveUrl(row.id).then((next) => {
      if (!cancelled) setUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [row.id, isImage, visible, resolveUrl]);

  const Icon = kindIcon(row.kind);
  const extension = row.extension.toUpperCase();
  const small = size === "xs" || size === "sm";
  return (
    <div ref={ref} {...stylex.props(styles.frame, styles[size])}>
      {isImage && url !== null ? (
        <img
          src={url}
          alt={row.alt || row.filename}
          {...stylex.props(styles.image, size === "preview" && styles.contain)}
        />
      ) : small ? (
        <span {...stylex.props(styles.tagPlain)}>{extension}</span>
      ) : (
        <>
          <Icon size={ICON_SIZE.empty} strokeWidth={ICON_STROKE.large} aria-hidden="true" />
          <span {...stylex.props(styles.tag)}>{extension}</span>
        </>
      )}
    </div>
  );
}
