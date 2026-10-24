// 案 A 6 章: URL 再編前の旧パス → 新パス。旧パスを実ルートとして残すと、型付きルーティングの
// 静的 union に旧 URL が載り続けて退行を検出できなくなるため、ルートファイルは置かず
// テナントレイアウトの beforeLoad でこの対応表だけを引く。
const LEGACY_SECTIONS: Readonly<Record<string, string>> = {
  records: "content",
  "content-types": "settings/content-types",
  assets: "media",
  modules: "settings/modules",
};

// 案 F 6 章・F26: asset 型はメディアライブラリが専用の画面を持つため、型の汎用画面
// (`/t/:slug/content/asset/...`)は残さない。一覧と新規作成は `media`、個別は `media/:id` へ。
function assetToMedia(pathname: string): string | null {
  const match = /^(\/t\/[^/]+\/)content\/asset(?:\/([^/]+))?$/.exec(pathname);
  if (match === null) {
    return null;
  }
  const [, prefix, id] = match;
  if (prefix === undefined) {
    return null;
  }
  return id === undefined || id === "new" ? `${prefix}media` : `${prefix}media/${id}`;
}

// `/t/:slug/<旧セクション>/...` を新しいパスへ置き換える。旧パスでなければ null。
// 旧セクション以降(型 key・レコード ID・new / edit)はそのまま引き継ぐ。
// 置き換えのあとで asset 型の規則を当てるため、旧 `records/asset/:id` も `media/:id` に着く。
export function legacyPathname(pathname: string): string | null {
  const match = /^(\/t\/[^/]+\/)([^/]+)(\/.*)?$/.exec(pathname);
  if (match === null) {
    return null;
  }
  const [, prefix, section, rest] = match;
  const next = section === undefined ? undefined : LEGACY_SECTIONS[section];
  const replaced =
    prefix === undefined || next === undefined ? null : `${prefix}${next}${rest ?? ""}`;
  return assetToMedia(replaced ?? pathname) ?? replaced;
}
