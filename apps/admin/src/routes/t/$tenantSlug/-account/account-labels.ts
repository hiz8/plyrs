export const ACCOUNT_LABELS = {
  title: "アカウント設定",
  email: {
    title: "メールアドレス",
    help: "ログインに使うメールアドレスです。変更は確認メールが必要になるため、現在は変更できません",
    loadFailed: "メールアドレスを取得できませんでした",
  },
  password: {
    title: "パスワードの変更",
    current: "現在のパスワード",
    next: "新しいパスワード",
    nextHelp: "12 文字以上",
    confirm: "新しいパスワード(確認)",
    note: "変更すると、他の端末のセッションはすべてログアウトされます",
    submit: "パスワードを変更",
    tooShort: "12 文字以上で入力してください",
    mismatch: "新しいパスワードが一致しません",
    changed: "パスワードを変更しました",
    changedWithRevoked: (n: number) =>
      `パスワードを変更しました。他の端末 ${n} 件をログアウトしました`,
    failed: "パスワードを変更できませんでした",
  },
  theme: {
    title: "テーマ",
    label: "テーマ",
    system: "自動",
    light: "ライト",
    dark: "ダーク",
    help: "「自動」は OS の設定に従います。選択はこのブラウザに記憶され、他の端末には引き継がれません",
  },
  sites: {
    title: "所属しているサイト",
    current: "現在のサイト",
    switch: "切り替える",
    loadFailed: "所属しているサイトを取得できませんでした",
  },
} as const;
