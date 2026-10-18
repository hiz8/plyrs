// 案 A 6 章: URL 再編前の旧パス → 新パス。旧パスを実ルートとして残すと、型付きルーティングの
// 静的 union に旧 URL が載り続けて退行を検出できなくなるため、ルートファイルは置かず
// テナントレイアウトの beforeLoad でこの対応表だけを引く。
const LEGACY_SECTIONS: Readonly<Record<string, string>> = {
  records: "content",
  "content-types": "settings/content-types",
  assets: "media",
  modules: "settings/modules",
};

// `/t/:slug/<旧セクション>/...` を新しいパスへ置き換える。旧パスでなければ null。
// 旧セクション以降(型 key・レコード ID・new / edit)はそのまま引き継ぐ。
export function legacyPathname(pathname: string): string | null {
  const match = /^(\/t\/[^/]+\/)([^/]+)(\/.*)?$/.exec(pathname);
  if (match === null) {
    return null;
  }
  const [, prefix, section, rest] = match;
  const next = section === undefined ? undefined : LEGACY_SECTIONS[section];
  if (prefix === undefined || next === undefined) {
    return null;
  }
  return `${prefix}${next}${rest ?? ""}`;
}
