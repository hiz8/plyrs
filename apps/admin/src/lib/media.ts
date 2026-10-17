import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import type { AssetUsageEntry } from "./admin-api";
import { labelForRecord } from "./record-label";

// 案 F 3.3・4 章: メディアライブラリの補助処理(アップロードの順次送信と、使用箇所の表示名の解決)。

// apps/api の routes/tenant.ts の MAX_ASSET_SIZE_BYTES(Phase 8 裁定 1)と同じ値。
// サーバーも 413 で弾くが、大きなファイルを送り切ってから断られないよう、送る前に確かめる
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const UPLOAD_TOO_LARGE_MESSAGE = "20 MB を超えるファイルはアップロードできません";

export function isTooLarge(file: Pick<File, "size">): boolean {
  return file.size > MAX_UPLOAD_BYTES;
}

export type UploadItem = { file: File } & (
  | { status: "queued" }
  | { status: "uploading" }
  | { status: "done"; assetId: string }
  | { status: "failed"; reason: "too_large" | "error"; cause?: unknown }
);

export interface UploadSummary {
  items: UploadItem[];
  succeeded: number;
  failed: number;
}

// API は 1 ファイルずつのため、選ばれた順に 1 件ずつ送る。大きすぎるファイルは送らずに失敗とし、
// 一部が失敗しても残りは続ける。onChange には毎回すべてのファイルの状態を新しい配列で渡す
// (グリッドの先頭に進捗付きで仮表示するため)。
export async function uploadFiles(
  files: readonly File[],
  upload: (file: File) => Promise<{ id: string }>,
  onChange?: (items: readonly UploadItem[]) => void,
): Promise<UploadSummary> {
  let items: UploadItem[] = files.map((file) =>
    isTooLarge(file) ? { file, status: "failed", reason: "too_large" } : { file, status: "queued" },
  );
  const update = (index: number, next: UploadItem) => {
    items = items.map((item, i) => (i === index ? next : item));
    onChange?.(items);
  };
  onChange?.(items);
  for (const [index, item] of items.entries()) {
    if (item.status !== "queued") {
      continue;
    }
    update(index, { file: item.file, status: "uploading" });
    try {
      const { id } = await upload(item.file);
      update(index, { file: item.file, status: "done", assetId: id });
    } catch (cause) {
      update(index, { file: item.file, status: "failed", reason: "error", cause });
    }
  }
  const succeeded = items.filter((item) => item.status === "done").length;
  return { items, succeeded, failed: items.length - succeeded };
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
  fieldLabel: string;
  /** 「お知らせ / アイキャッチ」の右側。本文中の画像は「本文中」 */
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
    const fieldLabel = field?.label ?? entry.sourceField;
    resolved.push({
      recordId: entry.sourceId,
      typeKey,
      typeName: definition?.name ?? typeKey ?? "不明な型",
      title: record === undefined ? entry.sourceId.slice(0, 8) : labelForRecord(types, record),
      fieldLabel,
      place: entry.origin === "body" ? BODY_PLACE : fieldLabel,
    });
  }
  return resolved;
}

// 削除の確認ダイアログの「2 件のコンテンツで使われています」に使う件数(案 F 4.1)
export function countUsingRecords(usage: readonly Pick<AssetUsageEntry, "sourceId">[]): number {
  return new Set(usage.map((entry) => entry.sourceId)).size;
}
