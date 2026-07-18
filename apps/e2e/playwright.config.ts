import { defineConfig } from "@playwright/test";

// 3 spec は共有 dev サーバー + 共有ローカル D1(1 テナント DO・1 super 管理者)を前提にしている。
// super-console.spec.ts が UI 経由の bootstrap を検証する唯一の spec であり、bootstrap は
// プロセス全体を通じて 1 回しか成立しない(2 回目は 403 already_bootstrapped)ため、
// 実行順序を projects/dependencies で明示的に固定する(ファイル名のアルファベット順に
// 頼らない — Playwright のデフォルト順序は保証された契約ではない)。
// helpers/setup.ts が super-console.spec.ts の bootstrap で得た totp secret を
// apps/e2e/.state/ へ永続化し、後続の spec はそれを読んでログインする。
//
// globalSetup は使わない: 実測したところ Playwright は globalSetup の完了を待たず
// webServer を並行 spawn する。dev サーバーは .dev.vars を起動時に 1 回しか読まないため、
// globalSetup 経由で書くと「サーバーが空の JWT_SECRET で先に起動してしまう」競合が実際に
// 発生した(詳細は global-setup.ts のコメントと task-16-report.md 参照)。代わりに
// package.json の "test" スクリプトが `node global-setup.ts && playwright test` の順で
// 直接実行し、webServer が spawn される前に .wrangler リセット・.dev.vars 作成・
// D1 マイグレーション適用を完了させる。
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // 共有 dev サーバー + 共有ローカル D1 のため直列
  use: { baseURL: "http://localhost:5199" },
  webServer: {
    command: "pnpm --filter @plyrs/admin exec vite dev --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "super-console", testMatch: /super-console\.spec\.ts/ },
    { name: "core-journey", testMatch: /core-journey\.spec\.ts/, dependencies: ["super-console"] },
    { name: "two-tab-sync", testMatch: /two-tab-sync\.spec\.ts/, dependencies: ["core-journey"] },
  ],
});
