import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import type { AssetUsageEntry } from "./admin-api";
import { ApiError } from "./api-client";
import { UPLOAD_TOO_LARGE_MESSAGE } from "./error-messages";
import { NetworkError } from "./network-error";
import { labelForRecord } from "./record-label";

// 案 F 3.3・4 章: メディアライブラリの補助処理(アップロードの順次送信と、使用箇所の表示名の解決)。

// apps/api の routes/tenant.ts の MAX_ASSET_SIZE_BYTES(Phase 8 裁定 1)と
// MAX_ASSET_FILENAME_LENGTH と同じ値。サーバーも 413 / 400 で弾くが、送り切ってから断られない
// よう、送る前に確かめる
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 256;

// 送る前に弾いたときも、サーバーの 413 で弾かれたときも同じ文言にする(案 F 3.3)
export { UPLOAD_TOO_LARGE_MESSAGE };

export function isTooLarge(file: Pick<File, "size">): boolean {
  return file.size > MAX_UPLOAD_BYTES;
}

export type UploadRejection = "too_large" | "empty" | "invalid_filename";

// サーバーが内容を見ずに断る条件を、送る前に判定する。送ってよければ null
export function uploadRejection(file: Pick<File, "size" | "name">): UploadRejection | null {
  if (isTooLarge(file)) {
    return "too_large";
  }
  if (file.size === 0) {
    return "empty";
  }
  if (file.name.length === 0 || file.name.length > MAX_FILENAME_LENGTH) {
    return "invalid_filename";
  }
  return null;
}

export type UploadItem = { file: File } & (
  | { status: "queued" }
  | { status: "uploading" }
  | { status: "done"; assetId: string }
  | { status: "failed"; reason: UploadRejection | "error"; cause?: unknown }
);

export interface UploadSummary {
  items: UploadItem[];
  succeeded: number;
  failed: number;
}

export interface UploadOptions {
  /** すべてのファイルの状態を、変わるたびに新しい配列で受け取る */
  onChange?: (items: readonly UploadItem[]) => void;
  /** 画面を離れたときなどに中止する。中止後は残りを送らず、queued のまま返す */
  signal?: AbortSignal;
}

// 接続できない・ログインが切れた・権限が無い、はファイルによらない失敗なので、残りを送っても
// 同じ理由で失敗する。そのときは残りを送らず、同じ原因で失敗にする
function isFatal(cause: unknown): boolean {
  return (
    cause instanceof NetworkError ||
    (cause instanceof ApiError && (cause.status === 401 || cause.status === 403))
  );
}

// API は 1 ファイルずつのため、選ばれた順に 1 件ずつ送る。送る前に断れるファイルは送らずに
// 失敗とし、ファイル単位の失敗なら残りは続ける。onChange には毎回すべてのファイルの状態を
// 新しい配列で渡す(グリッドの先頭に進捗付きで仮表示するため)。
export async function uploadFiles(
  files: readonly File[],
  upload: (file: File) => Promise<{ id: string }>,
  { onChange, signal }: UploadOptions = {},
): Promise<UploadSummary> {
  let items: UploadItem[] = files.map((file) => {
    const reason = uploadRejection(file);
    return reason === null ? { file, status: "queued" } : { file, status: "failed", reason };
  });
  const update = (index: number, next: UploadItem) => {
    items = items.map((item, i) => (i === index ? next : item));
    onChange?.(items);
  };
  onChange?.(items);
  // update が items を新しい配列に差し替えるため、毎回 items[index] を読み直す
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item === undefined || item.status !== "queued") {
      continue;
    }
    if (signal?.aborted === true) {
      break;
    }
    update(index, { file: item.file, status: "uploading" });
    try {
      const { id } = await upload(item.file);
      update(index, { file: item.file, status: "done", assetId: id });
    } catch (cause) {
      update(index, { file: item.file, status: "failed", reason: "error", cause });
      if (isFatal(cause)) {
        items = items.map((rest) =>
          rest.status === "queued"
            ? { file: rest.file, status: "failed", reason: "error", cause }
            : rest,
        );
        onChange?.(items);
        break;
      }
    }
  }
  return {
    items,
    succeeded: items.filter((item) => item.status === "done").length,
    failed: items.filter((item) => item.status === "failed").length,
  };
}

// 一部が失敗したときは、成功と失敗の件数を分けて知らせる(案 F 3.3)
export function uploadSummaryMessage({
  succeeded,
  failed,
}: Pick<UploadSummary, "succeeded" | "failed">): string {
  if (failed === 0) {
    return `${succeeded} 件のファイルをアップロードしました`;
  }
  if (succeeded === 0) {
    return `${failed} 件のファイルをアップロードできませんでした`;
  }
  return `${succeeded} 件のファイルをアップロードしました。${failed} 件はアップロードできませんでした`;
}

export interface ResolvedUsage {
  recordId: string;
  /** 参照元の型が分からない(手元に無い・削除済み)ときは null */
  typeKey: string | null;
  typeName: string;
  title: string;
  /** 参照しているフィールドの key(画面の React key や編集画面のフィールドへのリンクに使う) */
  fieldKey: string;
  /** 関係フィールドからの参照か、本文中の画像か(AssetUsageEntry.origin) */
  origin: string;
  /** 「お知らせ / アイキャッチ」の右側。フィールドの表示名で、本文中の画像は「本文中」 */
  place: string;
}

const BODY_PLACE = "本文中";

// 使用箇所を、参照元のタイトル・型名・フィールドの表示名で表す(案 F 4 章)。
// 同じコンテンツの同じフィールドに複数回使われていても 1 件にまとめる。
// 手元に無いレコードや型は、ID や key で代わりに表示する(関係はソフト参照のため欠けうる)。
export function resolveUsage(
  usage: readonly AssetUsageEntry[],
  types: ContentTypeDefinition[],
  recordById: (id: string) => SyncRecord | undefined,
): ResolvedUsage[] {
  const seen = new Set<string>();
  const resolved: ResolvedUsage[] = [];
  for (const entry of usage) {
    const key = `${entry.sourceId}\u0000${entry.sourceField}\u0000${entry.origin}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const record = recordById(entry.sourceId);
    const typeKey = entry.sourceType ?? record?.type ?? null;
    const definition = types.find((type) => type.key === typeKey);
    const field = definition?.fields.find((candidate) => candidate.key === entry.sourceField);
    resolved.push({
      recordId: entry.sourceId,
      typeKey,
      typeName: definition?.name ?? typeKey ?? "不明な型",
      title: record === undefined ? entry.sourceId.slice(0, 8) : labelForRecord(types, record),
      fieldKey: entry.sourceField,
      origin: entry.origin,
      place: entry.origin === "body" ? BODY_PLACE : (field?.label ?? entry.sourceField),
    });
  }
  return resolved;
}

// 削除の確認ダイアログの「2 件のコンテンツで使われています」に使う件数(案 F 4.1)
export function countUsingRecords(usage: readonly Pick<AssetUsageEntry, "sourceId">[]): number {
  return new Set(usage.map((entry) => entry.sourceId)).size;
}
