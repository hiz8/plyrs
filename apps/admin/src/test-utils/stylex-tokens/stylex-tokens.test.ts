import stylex from "@stylexjs/unplugin";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// 案 H トークン 5.1(ロードマップ T1)の検証を、使用中の StyleX の版で再現する。
// フィクスチャ(test-utils/stylex-tokens/)は 3 層トークンの最小構成で、StyleX を上げたときに
// 同じ書き方が通るかをこのテストで確かめる。
// jsdom 環境では import.meta.url が file: にならないため、パッケージ直下(vitest の実行位置)から引く
const FIXTURE = join(process.cwd(), "src/test-utils/stylex-tokens");

// lightningcss は @stylexjs/unplugin の依存。admin の直接の依存ではないため、そこから解決する
const { Features } = createRequire(
  createRequire(join(process.cwd(), "package.json")).resolve("@stylexjs/unplugin"),
)("lightningcss") as {
  Features: { LightDark: number };
};

let outDir: string;
let css: string;

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), "stylex-tokens-"));
  await build({
    root: FIXTURE,
    configFile: false,
    logLevel: "silent",
    // light-dark() を下位互換の形に書き換えさせない(5.1 の注意)
    plugins: [stylex.vite({ lightningcssOptions: { exclude: Features.LightDark } })],
    build: {
      outDir,
      lib: { entry: join(FIXTURE, "entry.ts"), formats: ["es"], fileName: "entry" },
    },
  });
  css = await readFile(join(outDir, "assets", "stylex.css"), "utf8");
}, 60_000);

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

// 宣言ブロック内の `--名前: 値` を集める(名前はハッシュのため値の形だけを見る)
function declarationValues(selectorPattern: RegExp): string[] {
  const values: string[] = [];
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectorPattern.test(block[1] ?? "")) {
      for (const decl of (block[2] ?? "").matchAll(/--[\w-]+:\s*([^;]+);/g)) {
        values.push((decl[1] ?? "").trim());
      }
    }
  }
  return values;
}

describe("StyleX 3 層トークン(案 H 5.1)", () => {
  it("defineVars の値に別ファイルの変数と light-dark() を書ける", () => {
    const semantic = declarationValues(/^\s*:root, \.[\w-]+\s*$/);
    expect(semantic).toContainEqual(
      expect.stringMatching(/^light-dark\(var\(--[\w-]+\), var\(--[\w-]+\)\)$/),
    );
    expect(semantic).toContainEqual(expect.stringMatching(/^var\(--[\w-]+\)$/));
    expect(semantic).toContain("#fff");
  });

  it("createTheme の値に別ファイルの変数を書け、二重クラスで :root の定義を上書きする", () => {
    const theme = declarationValues(/^\s*\.([\w-]+)\.\1, \.\1\.\1:root\s*$/);
    expect(theme).toContainEqual(
      expect.stringMatching(/^light-dark\(var\(--[\w-]+\), var\(--[\w-]+\)\)$/),
    );
    expect(theme).toContainEqual(expect.stringMatching(/^var\(--[\w-]+\)$/));
  });

  it("light-dark() を lightningcss の代替表現に書き換えない", () => {
    expect(css).not.toContain("--lightningcss-light");
  });
});
