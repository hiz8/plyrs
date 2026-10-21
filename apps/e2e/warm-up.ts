import { chromium } from "@playwright/test";

// dev サーバーの初回描画を温める(Playwright の globalSetup)。
//
// 実測(2026-10-21、V4-E): dev では routeTree.gen.ts 経由で全ルートのモジュールが最初の
// ページで読み込まれ、StyleX の変換が冷えた状態では見出しが出るまで約 28 秒かかる(温まると
// 約 7 秒)。V4-E で型設計の部品が増え、最初の spec の `expect`(15 秒)を超えるようになった。
// spec ごとの待ち時間を延ばす代わりに、ここで 1 回だけページを開いて変換のキャッシュを作る。
//
// Playwright の globalSetup は webServer の起動を待たず並行に走る(global-setup.ts の
// コメント参照)ため、まずサーバーが応えるまで自前で待つ。.dev.vars と D1 は package.json の
// "test" スクリプトが `playwright test` の前に global-setup.ts で整えているので、ここで
// サーバーの起動順を気にする必要は無い。
const BASE_URL = "http://localhost:5199";
const SERVER_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 120_000;

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/super-auth/status`);
      if (res.ok) return;
    } catch {
      // 起動前は接続できない
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`dev サーバーが ${SERVER_TIMEOUT_MS}ms 以内に応答しませんでした: ${BASE_URL}`);
}

export default async function warmUp(): Promise<void> {
  await waitForServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/super-login`);
    // bootstrap の前後どちらの見出しでもよい(ここでは何も操作しない)
    await page
      .getByRole("heading", { name: /初期セットアップ|運営コンソールへログイン/ })
      .waitFor({ timeout: RENDER_TIMEOUT_MS });
  } finally {
    await browser.close();
  }
}
