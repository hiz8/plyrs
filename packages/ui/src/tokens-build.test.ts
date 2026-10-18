import stylex from "@stylexjs/unplugin";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// 3 層トークン(h-design-tokens.md 5 章)の実体を Vite でビルドし、出力 CSS の形を確かめる。
// admin の stylex-tokens.test.ts は最小構成のフィクスチャで書き方を、こちらは実トークンを見る
const ENTRY = join(process.cwd(), "src/test-utils/tokens-entry.ts");

// lightningcss は @stylexjs/unplugin の依存。ui の直接の依存ではないため、そこから解決する
const { Features } = createRequire(
  createRequire(join(process.cwd(), "package.json")).resolve("@stylexjs/unplugin"),
)("lightningcss") as { Features: { LightDark: number } };

const SKELETON_ENTRY = join(process.cwd(), "src/test-utils/skeleton-entry.ts");

const outDirs: string[] = [];
let css: string;
let skeletonCss: string;

async function buildCss(entry: string): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), "ui-tokens-"));
  outDirs.push(outDir);
  await build({
    root: join(process.cwd(), "src"),
    configFile: false,
    logLevel: "silent",
    plugins: [stylex.vite({ lightningcssOptions: { exclude: Features.LightDark } })],
    build: { outDir, lib: { entry, formats: ["es"], fileName: "entry" } },
  });
  return readFile(join(outDir, "assets", "stylex.css"), "utf8");
}

beforeAll(async () => {
  css = await buildCss(ENTRY);
  skeletonCss = await buildCss(SKELETON_ENTRY);
}, 120_000);

afterAll(async () => {
  await Promise.all(outDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function rootValues(): string[] {
  const values: string[] = [];
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/:root/.test(block[1] ?? "")) {
      for (const decl of (block[2] ?? "").matchAll(/--[\w-]+:\s*([^;]+);/g)) {
        values.push((decl[1] ?? "").trim());
      }
    }
  }
  return values;
}

describe("3 層トークンの出力(h-design-tokens.md 5 章)", () => {
  it("プリミティブは値そのもの、セマンティックの色は light-dark() でプリミティブを参照する", () => {
    const values = rootValues();
    expect(values).toContain("#2563eb");
    expect(values).toContainEqual(
      expect.stringMatching(/^light-dark\(var\(--[\w-]+\), var\(--[\w-]+\)\)$/),
    );
  });

  it("elevation は影の色だけを light-dark() で切り替える", () => {
    expect(rootValues()).toContainEqual(
      expect.stringMatching(
        /^0 1px 2px light-dark\(var\(--[\w-]+\), var\(--[\w-]+\)\), 0 4px 12px light-dark\(/,
      ),
    );
  });

  it("旧名はセマンティックの別名(var 参照)になり、生の値を持たない", () => {
    expect(css).not.toContain("prefers-color-scheme");
    expect(css).not.toContain("--lightningcss-light");
  });
});

describe("Skeleton の出力", () => {
  it("動きを減らす設定では @media の中で animation-name を none にする", () => {
    const compact = skeletonCss.replace(/\s+/g, "");
    expect(compact).toMatch(
      /@media\(prefers-reduced-motion:reduce\)\{[^{}]*\{[^{}]*animation-name:none/,
    );
  });
});
