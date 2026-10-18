// design-sync 用の packages/ui のライブラリビルド(アプリのビルドとは別)。
// packages/ui は src を直接 export しており、StyleX はコンパイルが必須のため、
// ここで StyleX を通した ESM と CSS を .design-sync/.cache/ui-dist/ に出す。
// 実行: corepack pnpm --filter @plyrs/ui exec vite build --config ../../.design-sync/ui-build.vite.mjs
// このファイルは .design-sync/ にあるため、依存は packages/ui から解決する。
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(here, "../packages/ui");
const requireFromUi = createRequire(resolve(uiDir, "package.json"));
const importFromUi = (name) => import(pathToFileURL(requireFromUi.resolve(name)).href);

const { default: stylex } = await importFromUi("@stylexjs/unplugin");
// lightningcss は @stylexjs/unplugin の依存(admin の vite.config.ts と同じ解決方法)
const { Features } = createRequire(requireFromUi.resolve("@stylexjs/unplugin"))("lightningcss");

const pkg = requireFromUi("./package.json");
const external = [...Object.keys(pkg.dependencies ?? {}), "react-dom", "react/jsx-runtime"];

export default {
  root: uiDir,
  configFile: false,
  logLevel: "warn",
  plugins: [
    stylex.vite({ lightningcssOptions: { exclude: Features.LightDark } }),
    // design-sync の変換ツールは --entry から最寄りの名前付き package.json を
    // パッケージの置き場所とみなすため、出力先をパッケージの形にしておく
    {
      name: "design-sync-package-json",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "package.json",
          source: `${JSON.stringify(
            {
              name: pkg.name,
              version: pkg.version,
              type: "module",
              module: "index.js",
              types: "index.d.ts",
              dependencies: pkg.dependencies,
            },
            null,
            2,
          )}\n`,
        });
      },
    },
  ],
  css: { lightningcss: { exclude: Features.LightDark } },
  build: {
    outDir: resolve(here, ".cache/ui-dist"),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: resolve(uiDir, "src/index.ts"), formats: ["es"], fileName: "index" },
    rollupOptions: {
      external: (id) => external.some((dep) => id === dep || id.startsWith(`${dep}/`)),
    },
  },
};
