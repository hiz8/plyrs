import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  THEME_BOOT_SCRIPT,
  THEME_STORAGE_KEY,
  applyThemePreference,
  readThemePreference,
  saveThemePreference,
} from "./theme";

afterEach(() => {
  localStorage.clear();
  document.documentElement.style.colorScheme = "";
});

const throwingStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
} as unknown as Storage;

describe("テーマの選択(h-design-tokens.md 4 章)", () => {
  it("既定は自動", () => {
    expect(readThemePreference()).toBe("system");
  });

  it("記憶した選択を読む。知らない値は自動として扱う", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readThemePreference()).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readThemePreference()).toBe("system");
  });

  it("自動を選んだら記憶を消す", () => {
    saveThemePreference("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    saveThemePreference("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("ストレージが例外を投げても落ちない", () => {
    expect(readThemePreference(throwingStorage)).toBe("system");
    expect(() => saveThemePreference("dark", throwingStorage)).not.toThrow();
  });

  it("ルートの color-scheme に書く", () => {
    applyThemePreference("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    applyThemePreference("system");
    expect(document.documentElement.style.colorScheme).toBe("light dark");
  });

  it("起動時スクリプトは記憶した選択を JS の読み込み前に当てる", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("styles.css が自動(light dark)を既定に宣言している", () => {
    // light-dark() は color-scheme が無いと常にライトを選ぶ。宣言が消えると OS がダークの人がライトになる
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light dark;/);
  });
});
