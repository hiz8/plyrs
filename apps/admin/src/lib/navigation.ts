import type { ModuleSummary } from "./admin-api";

// 同期の ContentTypeDefinition(menuOrder?: number)と HTTP の ContentTypeSummary
// (menuOrder: number | null)の両方が満たす最小形。
export interface NavType {
  key: string;
  name: string;
  source: "user" | "plugin" | "system";
  menuOrder?: number | null;
}

// サイドバーに並べるのは利用者の型だけ。menuOrder 昇順(未設定は後ろ)、同順は名前順。
export function sidebarContentTypes<T extends NavType>(types: readonly T[]): T[] {
  return types
    .filter((type) => type.source === "user")
    .toSorted((a, b) => {
      const ao = a.menuOrder ?? Number.POSITIVE_INFINITY;
      const bo = b.menuOrder ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao < bo ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });
}

export interface ModuleNavGroup {
  moduleId: string;
  name: string;
  types: { key: string; name: string }[];
}

// 有効なモジュールだけ。navTypes の順で、同期済みの型に同じ key があるものだけを持つ。
export function moduleNavGroups(
  modules: readonly Pick<ModuleSummary, "moduleId" | "name" | "enabled" | "navTypes">[],
  types: readonly NavType[],
): ModuleNavGroup[] {
  const byKey = new Map(types.map((type) => [type.key, type]));
  return modules
    .filter((m) => m.enabled)
    .map((m) => ({
      moduleId: m.moduleId,
      name: m.name,
      types: m.navTypes.flatMap((key) => {
        const type = byKey.get(key);
        return type ? [{ key: type.key, name: type.name }] : [];
      }),
    }));
}

// `$name` をパラメータで置き換える。無い名前はそのまま残す。
export function resolveNavHref(to: string, params: Readonly<Record<string, string>>): string {
  return to.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, name: string) => params[name] ?? whole);
}

export interface NavEntry {
  key: string;
  href: string;
  matchPrefix?: string;
  // true なら pathname が href と一致するときだけ当てる(前方一致しない)
  exact?: boolean;
}

// pathname に当てはまる項目のうち、(matchPrefix ?? href) が最長のものの key。
export function activeNavKey(entries: readonly NavEntry[], pathname: string): string | null {
  let best: { key: string; length: number } | null = null;
  for (const entry of entries) {
    const base = entry.matchPrefix ?? entry.href;
    const matches =
      pathname === entry.href ||
      (entry.exact !== true && (pathname === entry.matchPrefix || pathname.startsWith(`${base}/`)));
    if (matches && (best === null || base.length > best.length)) {
      best = { key: entry.key, length: base.length };
    }
  }
  return best?.key ?? null;
}
