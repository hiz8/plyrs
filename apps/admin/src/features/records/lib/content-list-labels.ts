import type { ListTab } from "./list-tab";
import { COMMON_LABELS } from "~/lib/labels";

// コンテンツの一覧(タブ・絞り込み・表・ページ送り)の文言
export const LIST_LABELS = {
  add: (type: string) => `${type}を追加`,
  tabs: {
    all: "すべて",
    published: "公開中",
    "unpublished-changes": "未反映の変更あり",
    unpublished: "未公開",
    archived: "アーカイブ",
  } satisfies Record<ListTab, string>,
  tabsName: "公開状態",
  statusFilter: "ステータス",
  statusAll: "すべて",
  search: "タイトルで検索",
  tableLabel: (type: string) => `${type}の一覧`,
  columns: { title: "タイトル", publication: "公開", status: "ステータス", updated: "更新" },
  // 追加列(listColumns)のセル(K3)
  cell: { empty: "—", yes: "はい", no: "いいえ", count: (n: number) => `${n} 件` },
  changedShort: "公開中・未反映",
  changedLong: "公開中・未反映の変更あり",
  rowActions: { edit: "編集", view: "表示", delete: "削除" },
  failed: "失敗",
  empty: {
    title: (type: string) => `${type}はまだありません`,
    description: (type: string) =>
      `追加した${type}はここに一覧で表示され、公開するとサイトに載ります`,
  },
  noResults: {
    title: (q: string, type: string) =>
      q === "" ? `条件に一致する${type}はありません` : `「${q}」に一致する${type}はありません`,
    description: (filters: string) =>
      `${filters}で絞り込んでいます。別の言葉で検索するか、絞り込みを解除してください`,
    clear: COMMON_LABELS.clearFilters,
  },
  perPage: (n: number) => `1 ページ ${n} 件`,
  perPageLabel: "1 ページの件数",
  range: (total: number, from: number, to: number) => `${total} 件中 ${from}〜${to} 件`,
  pager: "ページ送り",
  prev: "前のページ",
  next: "次のページ",
  page: (n: number) => `${n} ページ目`,
  readOnly: COMMON_LABELS.readOnly,
  publicationsFailed: "公開状態を取得できませんでした",
  retry: COMMON_LABELS.retry,
} as const;
