import { useCallback, useState } from "react";

// h-design-tokens.md 4 章: 自動(OS の設定)/ ライト / ダークの 3 択。既定は自動。
// 選択はブラウザに記憶し、ルートの color-scheme に書く(セマンティックトークンの light-dark() が従う)。
// アカウント単位の保存は未決(6 章)。
export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "plyrs.theme";

const COLOR_SCHEME: Record<ThemePreference, string> = {
  system: "light dark",
  light: "light",
  dark: "dark",
};

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readThemePreference(storage = defaultStorage()): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    // プライベートウィンドウなどで例外になる。記憶が無いのと同じ扱いにする
    return "system";
  }
}

export function saveThemePreference(preference: ThemePreference, storage = defaultStorage()): void {
  try {
    if (preference === "system") storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // 記憶できなくても、このタブの間は applyThemePreference の結果が残る
  }
}

export function applyThemePreference(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
): void {
  root.style.colorScheme = COLOR_SCHEME[preference];
}

// /_shell の <head> に置く起動時スクリプト。JS の本体より前に走り、記憶した選択と違う配色で
// 一瞬描画されるのを防ぐ。上の関数と同じ規則を、依存の無い 1 行で書く
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.style.colorScheme=t}catch(e){}`;

export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference());
  const update = useCallback((next: ThemePreference) => {
    saveThemePreference(next);
    applyThemePreference(next);
    setPreference(next);
  }, []);
  return [preference, update];
}
