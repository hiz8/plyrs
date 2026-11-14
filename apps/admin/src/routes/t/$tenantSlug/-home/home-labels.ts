// b-home.md: ホーム(ダッシュボード)の文言
export const HOME_LABELS = {
  meta: (email: string, role: string) => `${email} ・ ${role}`,
  readOnly: "閲覧のみ",
  readOnlyMeta: (email: string) => `閲覧のみ ・ ${email}`,
  quickAdd: "新規追加",
  drafts: {
    title: "自分の下書き",
    note: "最後に自分が編集した 5 件",
    empty: "下書きはありません",
    emptyHint: "上の「新規追加」から書き始められます",
    seeAll: "下書きをすべて見る",
    failed: "下書きを表示できませんでした",
  },
  review: {
    title: "確認待ち",
    note: "型をまたいで集計",
    empty: "確認待ちのコンテンツはありません",
    description: {
      in_review: "公開前に確認が必要なもの",
      ready: "確認済みで、公開を待っているもの",
      changed: "公開後に編集されたもの",
    },
    changedFailed: "未反映の変更を確認できませんでした",
  },
  recent: {
    title: "最近の更新",
    note: "更新日時の新しい順に 10 件",
    empty: "まだ更新はありません",
  },
  count: (n: number) => `${n} 件`,
  typeCount: (name: string, n: number) => `${name} ${n}`,
  retry: "再試行",
  // グリッドの aria-label
  widgets: "モジュールのウィジェット",
  // カードの項目の区切り(home-card)
  separator: " ・ ",
  gettingStarted: {
    title: "はじめに",
    description: (site: string) =>
      `「${site}」を使い始めるための手順です。1 つ目が終わると、ホームは普段の表示に変わります。`,
    createType: {
      title: "コンテンツタイプを作成する",
      body: "「お知らせ」「ブログ」のような、サイトに載せる内容の種類を決めます。タイトルや本文などのフィールドを持たせます。",
      action: "コンテンツタイプを作成",
    },
    uploadMedia: {
      title: "メディアをアップロードする",
      body: "画像や PDF を先に入れておくと、記事を書くときに選ぶだけで済みます。",
      action: "メディアを開く",
    },
    inviteMembers: {
      title: "メンバーを招待する",
      body: "編集を手伝ってくれる人を、設定 › メンバーから追加します。追加できるのは plyrs に登録済みの人です",
      action: "メンバーを追加",
    },
  },
  noTypes: {
    title: "コンテンツの種類がまだありません",
    description:
      "サイトの管理者に、コンテンツタイプの作成を依頼してください。作成されると、ここに新規追加の入口と最近の更新が表示されます",
  },
} as const;
