import { cloudflare } from "@cloudflare/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { defineConfig } from "vite";

// h-design-tokens.md 5 章: lightningcss に light-dark() を --lightningcss-light 等の代替表現へ
// 書き換えさせない(color-scheme の宣言が同じ処理に無いとダークが壊れる)。lightningcss は
// @stylexjs/unplugin の依存のため、そこから解決する
const requireFromConfig = createRequire(import.meta.url);
const { Features } = createRequire(requireFromConfig.resolve("@stylexjs/unplugin"))(
  "lightningcss",
) as { Features: { LightDark: number } };

export default defineConfig(({ command }) => ({
  // Vite 自身の CSS 最小化(lightningcss)も styles.css の color-scheme を同じ処理で書き換えるため、
  // stylex 側と同じ除外を渡す
  css: { lightningcss: { exclude: Features.LightDark } },
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // dev でも service binding（API）を成立させる: api Worker を同じ dev サーバーで
      // auxiliary worker として起動する。build には含めない（api は独立デプロイ）。
      ...(command === "serve"
        ? { auxiliaryWorkers: [{ configPath: "../api/wrangler.jsonc" }] }
        : {}),
    }),
    // 管理画面は SPA 寄り（tech-selection §1.1）。シェルはビルド時に prerender される。
    tanstackStart({ spa: { enabled: true } }),
    // tech-selection §1.3: StyleX プラグインは @vitejs/plugin-react より前（Fast Refresh 維持）
    stylex.vite({ lightningcssOptions: { exclude: Features.LightDark } }),
    viteReact(),
  ],
}));
