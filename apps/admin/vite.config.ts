import { cloudflare } from "@cloudflare/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
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
    stylex.vite(),
    viteReact(),
  ],
}));
