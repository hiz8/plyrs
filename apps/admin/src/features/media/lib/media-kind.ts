// メディアの種類の値。一覧の判定(media-list.ts)と種類の文言(media-labels.ts)の両方が使うので、
// どちらからも参照される小さなモジュールに置き、2 つのファイルの相互参照を避ける

export type MediaKind = "image" | "pdf" | "video" | "audio" | "other";
export const MEDIA_KINDS: readonly MediaKind[] = ["image", "pdf", "video", "audio", "other"];
