import type { SyncRecord } from "@plyrs/sync-protocol";
import type { ResolvedUsage } from "./media";

// 案 F 3 章: メディアライブラリの一覧の絞り込み・並べ替えと URL クエリとの相互変換。
// 一覧のデータは同期で手元にあるため、すべて画面側の純関数で行う(content-list.ts と同じ方針)。

export type MediaKind = "image" | "pdf" | "video" | "audio" | "other";
export const MEDIA_KINDS: readonly MediaKind[] = ["image", "pdf", "video", "audio", "other"];

// F19: MIME の先頭で 5 種に分ける
export function mediaKindOf(contentType: string): MediaKind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "pdf";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return "other";
}

export type MediaSort = "newest" | "name";
const MEDIA_SORTS: readonly MediaSort[] = ["newest", "name"];
const MEDIA_USAGES = ["all", "unused"] as const;

export interface MediaQuery {
  kind: MediaKind | "all";
  usage: "all" | "unused";
  q: string;
  sort: MediaSort;
}

export const DEFAULT_MEDIA_QUERY: MediaQuery = { kind: "all", usage: "all", q: "", sort: "newest" };

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return (values as readonly unknown[]).includes(value) ? (value as T) : undefined;
}

// TanStack Router の search パーサは値を JSON として読むため、?q=2026 は number で届く
// (content-list.ts の searchText と同じ規則)
function searchText(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

// F6: 手で書き換えられた不正な値は既定に戻す
export function parseMediaQuery(search: Record<string, unknown>): MediaQuery {
  return {
    kind: oneOf([...MEDIA_KINDS, "all"] as const, search["kind"]) ?? DEFAULT_MEDIA_QUERY.kind,
    usage: oneOf(MEDIA_USAGES, search["usage"]) ?? DEFAULT_MEDIA_QUERY.usage,
    q: searchText(search["q"]),
    sort: oneOf(MEDIA_SORTS, search["sort"]) ?? DEFAULT_MEDIA_QUERY.sort,
  };
}

// URL クエリへ。既定値は省いて URL を短く保つ
export function toMediaSearch(query: Partial<MediaQuery>): Record<string, string> {
  const full = { ...DEFAULT_MEDIA_QUERY, ...query };
  const search: Record<string, string> = {};
  if (full.kind !== DEFAULT_MEDIA_QUERY.kind) search["kind"] = full.kind;
  if (full.usage !== DEFAULT_MEDIA_QUERY.usage) search["usage"] = full.usage;
  if (full.q !== "") search["q"] = full.q;
  if (full.sort !== DEFAULT_MEDIA_QUERY.sort) search["sort"] = full.sort;
  return search;
}

// 「絞り込みを解除」を出すかどうか。並び順は絞り込みではない
export function hasMediaFilters(query: MediaQuery): boolean {
  return (
    query.kind !== DEFAULT_MEDIA_QUERY.kind ||
    query.usage !== DEFAULT_MEDIA_QUERY.usage ||
    query.q.trim() !== ""
  );
}

// F23: アップロード日時は UUIDv7 の先頭 48 bit(ミリ秒)から。形が違えば null
export function uploadedAtOf(id: string): Date | null {
  const hex = id.replaceAll("-", "").slice(0, 12);
  if (!/^[0-9a-f]{12}$/i.test(hex)) return null;
  return new Date(parseInt(hex, 16));
}

export interface MediaRow {
  record: SyncRecord;
  id: string;
  filename: string;
  contentType: string;
  kind: MediaKind;
  size: number;
  width: number | null;
  height: number | null;
  alt: string;
  caption: string;
  uploadedAt: Date | null;
  extension: string;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// 拡張子の表示(最大 4 文字、無ければ "?")
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "?" : filename.slice(dot + 1, dot + 5);
}

// 削除済み(トゥームストーン)は出さない。tolerant read のため input の型が合わない値は既定にする
export function buildMediaRows(records: readonly SyncRecord[]): MediaRow[] {
  return records
    .filter((record) => record.deletedAt === null)
    .map((record) => {
      const filename = textOf(record.input["filename"]);
      const contentType = textOf(record.input["content_type"]);
      return {
        record,
        id: record.id,
        filename,
        contentType,
        kind: mediaKindOf(contentType),
        size: numberOrNull(record.input["size"]) ?? 0,
        width: numberOrNull(record.input["width"]),
        height: numberOrNull(record.input["height"]),
        alt: textOf(record.input["alt"]),
        caption: textOf(record.input["caption"]),
        uploadedAt: uploadedAtOf(record.id),
        extension: extensionOf(filename),
      };
    });
}

// 全角・半角や大文字・小文字の違いを無視して部分一致させる(content-list.ts と同じ)
function normalizeForSearch(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("ja");
}

// F23(裁定で改定): 連番のファイル名が多いので数字を数として比べる自然順。大文字小文字は Collator の既定で区別する
const nameCollator = new Intl.Collator("ja", { numeric: true });

// kind / usage / q(F22: ファイル名と代替テキスト)で絞り、sort で並べる。
// orphanIds が null(使用状況が未取得)のときは usage の絞り込みを無視する
export function applyMediaQuery(
  rows: readonly MediaRow[],
  query: MediaQuery,
  orphanIds: ReadonlySet<string> | null,
): MediaRow[] {
  const needle = normalizeForSearch(query.q.trim());
  const filtered = rows.filter(
    (row) =>
      (query.kind === "all" || row.kind === query.kind) &&
      (query.usage === "all" || orphanIds === null || orphanIds.has(row.id)) &&
      (needle === "" ||
        normalizeForSearch(row.filename).includes(needle) ||
        normalizeForSearch(row.alt).includes(needle)),
  );
  // 同点は id 降順(UUIDv7 = 新しいものが先)
  const byIdDesc = (a: MediaRow, b: MediaRow) => b.id.localeCompare(a.id);
  if (query.sort === "name") {
    return filtered.toSorted(
      (a, b) => nameCollator.compare(a.filename, b.filename) || byIdDesc(a, b),
    );
  }
  // F23: 時刻が読めない行(uploadedAt null)は末尾
  return filtered.toSorted((a, b) => {
    if (a.uploadedAt === null || b.uploadedAt === null) {
      if (a.uploadedAt === b.uploadedAt) return byIdDesc(a, b);
      return a.uploadedAt === null ? 1 : -1;
    }
    return b.uploadedAt.getTime() - a.uploadedAt.getTime() || byIdDesc(a, b);
  });
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  return size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export type MediaView = "grid" | "list";
export const MEDIA_VIEW_STORAGE_KEY = "plyrs.media.view"; // F2

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

// theme.ts と同じ様式: ストレージが使えなくても画面は既定で動く
export function readMediaView(storage = defaultStorage()): MediaView {
  try {
    return storage?.getItem(MEDIA_VIEW_STORAGE_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export function saveMediaView(view: MediaView, storage = defaultStorage()): void {
  try {
    if (view === "grid") storage?.removeItem(MEDIA_VIEW_STORAGE_KEY);
    else storage?.setItem(MEDIA_VIEW_STORAGE_KEY, view);
  } catch {
    // 記憶できなくても、このタブの間は画面の state が残る
  }
}

const USAGE_TITLES_SHOWN = 3;

// F37: 削除確認に出す「(a、b、c、ほか 2 件)」。同じコンテンツは recordId で 1 件にまとめる
export function usageTitles(usage: readonly ResolvedUsage[]): { titles: string; rest: number } {
  const seen = new Map<string, string>();
  for (const entry of usage) {
    if (!seen.has(entry.recordId)) seen.set(entry.recordId, entry.title);
  }
  const all = [...seen.values()];
  return {
    titles: all.slice(0, USAGE_TITLES_SHOWN).join("、"),
    rest: Math.max(0, all.length - USAGE_TITLES_SHOWN),
  };
}

// F11: orphanIds(どこからも使われていない asset の id)に無い件数 = 使用中の件数
export function inUseCount(ids: readonly string[], orphanIds: ReadonlySet<string>): number {
  return ids.filter((id) => !orphanIds.has(id)).length;
}
