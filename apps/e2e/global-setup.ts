import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// 実測(実装時の検証、手順は task-16-report.md 参照): `pnpm --filter @plyrs/admin exec
// vite dev` は @cloudflare/vite-plugin の auxiliaryWorkers 経由で api Worker を同じ dev
// サーバーに同居させるため、D1/DO/KV/R2 のローカル永続化はすべて admin 側の
// apps/admin/.wrangler/state 配下に集約される。apps/api/.wrangler は tmp のみで実データは
// 一切乗らない。それでも api を独立 wrangler dev で動かす経路(将来の変更)に備え両方消す。
const adminWranglerDir = path.join(repoRoot, "apps/admin/.wrangler");
const apiWranglerDir = path.join(repoRoot, "apps/api/.wrangler");
// 上と同じ実測の裏返し: 永続化ディレクトリが実在しても、その中の D1 は空の SQLite ファイル
// でしかなくスキーマが無い(`vite dev` / auxiliaryWorkers 経由では wrangler dev 単体と違い
// マイグレーションが自動適用されない)。適用しないまま起動すると全 API が
// `no such table: super_admins` 相当で 500 になる。global-setup で毎回明示的に適用する。
const adminPersistDir = path.join(adminWranglerDir, "state");
const apiDir = path.join(repoRoot, "apps/api");

function applyLocalMigrations(binding: "DB" | "PROJECTION_DB"): void {
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      binding,
      "--local",
      "--persist-to",
      adminPersistDir,
      "-c",
      "wrangler.jsonc",
    ],
    { cwd: apiDir, stdio: "inherit" },
  );
}

export default function globalSetup(): void {
  // ローカル永続化をリセット(bootstrap 空前提・slug 一意の再現性)。開発データは消える(手順書に記載)。
  for (const dir of [adminWranglerDir, apiWranglerDir]) {
    rmSync(dir, { recursive: true, force: true });
  }
  // helpers/setup.ts が super-console.spec.ts の bootstrap 結果(totp secret)を書き出す
  // キャッシュ。.wrangler を消した以上、前回実行の secret は無効なので合わせて消す。
  rmSync(path.join(repoRoot, "apps/e2e/.state"), { recursive: true, force: true });

  const apiVars = path.join(repoRoot, "apps/api/.dev.vars");
  if (!existsSync(apiVars)) {
    writeFileSync(apiVars, "JWT_SECRET=e2e-secret-do-not-use-in-prod-0123456789\n");
  }
  const adminVars = path.join(repoRoot, "apps/admin/.dev.vars");
  if (!existsSync(adminVars)) {
    writeFileSync(adminVars, "DEV_PROXY_PUBLIC=1\n");
  }

  // dev サーバー(webServer)が起動する前に空の D1 へスキーマを流し込んでおく。
  applyLocalMigrations("DB");
  applyLocalMigrations("PROJECTION_DB");
}

// 実測(実装時の検証): Playwright の `globalSetup` は `webServer` の起動を待たない
// (webServer は globalSetup と並行に spawn される)。dev サーバーは .dev.vars を起動時に
// 1 回だけ読むため、globalSetup 経由だと「サーバーが先に空の JWT_SECRET で起動してしまい、
// 後から .dev.vars を書いても手遅れ」という競合が実際に発生した(super api 500:
// misconfigured)。そのため playwright.config.ts の globalSetup には登録せず、
// package.json の "test" スクリプトから `playwright test` の前に直接 node で実行する
// (`node global-setup.ts && playwright test`)。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  globalSetup();
}
