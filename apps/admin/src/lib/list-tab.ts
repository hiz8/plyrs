// 一覧のタブ(公開状態での絞り込み)の値。一覧の判定(content-list.ts)とタブの文言(content-list-labels.ts)の
// 両方が使うので、どちらからも参照される小さなモジュールに置き、2 つのファイルの相互参照を避ける

// URL の値をそのまま使う(例: ?tab=unpublished-changes)
export const LIST_TABS = [
  "all",
  "published",
  "unpublished-changes",
  "unpublished",
  "archived",
] as const;
export type ListTab = (typeof LIST_TABS)[number];
