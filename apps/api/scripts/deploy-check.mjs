// デプロイ前検査(ロードマップ 10 章、PR #72 の再発防止)。
// vitest(workerd)も dev サーバーもモジュールを要求の中で読み込むため、モジュールのトップレベルで
// 禁止された操作(Response の組み立てなど。検証エラー 10021)をしても CI では再現しない。本番と同じ
// バンドルを `wrangler deploy --dry-run` で作り、binding を持たない最小の設定で `wrangler dev --no-bundle`
// を起動して、起動時(トップレベルの評価)にエラーが出ないかを見る。ネットワークと API トークンは使わない。
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 90_000;
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1", FORCE_COLOR: "0" };

// wrangler.jsonc の compatibility_date / compatibility_flags をそのまま使う(コメントと末尾カンマを落として読む)
function readCompat() {
  const text = readFileSync(join(apiDir, "wrangler.jsonc"), "utf8");
  const date = /"compatibility_date"\s*:\s*"([^"]+)"/.exec(text)?.[1];
  const flags = /"compatibility_flags"\s*:\s*(\[[^\]]*\])/.exec(text)?.[1];
  if (date === undefined) {
    throw new Error("wrangler.jsonc に compatibility_date が無い");
  }
  return { date, flags: flags === undefined ? [] : JSON.parse(flags) };
}

const work = mkdtempSync(join(tmpdir(), "plyrs-deploy-check-"));
let exitCode = 1;
try {
  const outDir = join(work, "out");
  const bundle = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "deploy",
      "--dry-run",
      "--env",
      "preview",
      "--outdir",
      outDir,
      "-c",
      "wrangler.jsonc",
    ],
    { cwd: apiDir, env, encoding: "utf8" },
  );
  if (bundle.status !== 0) {
    process.stderr.write(bundle.stdout + bundle.stderr);
    throw new Error("dry-run のバンドルに失敗した");
  }
  const { date, flags } = readCompat();
  const config = join(work, "wrangler.json");
  writeFileSync(
    config,
    JSON.stringify({
      name: "deploy-check",
      main: "out/index.js",
      compatibility_date: date,
      compatibility_flags: flags,
      no_bundle: true,
    }),
  );
  exitCode = await new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      ["exec", "wrangler", "dev", "-c", config, "--port", "0", "--ip", "127.0.0.1"],
      { cwd: apiDir, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let settled = false;
    const finish = (code, message) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      if (code !== 0) {
        process.stderr.write(output);
      }
      console.log(message);
      resolve(code);
    };
    const timer = setTimeout(() => finish(1, "wrangler dev が時間内に起動しなかった"), TIMEOUT_MS);
    const onData = (chunk) => {
      output += chunk.toString();
      if (/Uncaught|Disallowed operation|✘ \[ERROR\]|service core:user:/.test(output)) {
        finish(1, "起動時(モジュールのトップレベル)にエラーが出た");
      } else if (/Ready on http/.test(output)) {
        finish(0, "deploy-check: バンドルはトップレベルのエラーなしで起動した");
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => finish(1, `wrangler dev が起動前に終了した(exit ${code})`));
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);
