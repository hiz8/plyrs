// Dependabot PR を自動マージしてよいかを判定する(.github/workflows/dependabot-auto-merge.yml から実行)。
//
// 方針:
// - major: 手動マージ
// - minor: 更新前が 1.0 以上かつ exact pin でなければ自動、0.x 系と exact pin 対象は手動
// - patch: 自動
// グループ PR は含まれる全依存が自動の条件を満たすときだけ自動にする。
//
// 入力(環境変数): UPDATED_DEPENDENCIES_JSON(dependabot/fetch-metadata の updated-dependencies-json)
// 出力($GITHUB_OUTPUT): decision=auto|manual、reason=手動の理由(Markdown の箇条書き)
import { appendFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** pnpm-workspace.yaml の catalog と各 package.json から exact pin されている依存名を集める */
function collectExactPins(root) {
  const pins = new Set();

  const workspace = join(root, "pnpm-workspace.yaml");
  if (existsSync(workspace)) {
    let inCatalog = false;
    for (const line of readFileSync(workspace, "utf8").split("\n")) {
      if (/^\S/.test(line)) {
        inCatalog = line.trim() === "catalog:";
        continue;
      }
      if (!inCatalog) continue;
      const m = /^\s+("?)([^"\s]+)\1:\s*("?)([^"\s]+)\3\s*$/.exec(line);
      if (m && EXACT_VERSION.test(m[4])) pins.add(m[2]);
    }
  }

  const manifests = [join(root, "package.json")];
  for (const dir of ["apps", "packages"]) {
    if (!existsSync(join(root, dir))) continue;
    for (const name of readdirSync(join(root, dir))) {
      const path = join(root, dir, name, "package.json");
      if (existsSync(path)) manifests.push(path);
    }
  }
  for (const path of manifests) {
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    for (const field of DEP_FIELDS) {
      for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
        if (EXACT_VERSION.test(spec)) pins.add(name);
      }
    }
  }
  return pins;
}

function majorOf(version) {
  return Number.parseInt(String(version ?? "").replace(/^v/, ""), 10);
}

/** 手動マージにすべき理由を返す。自動でよければ null */
function manualReason(dep, exactPins) {
  const name = dep.dependencyName;
  switch (dep.updateType) {
    case "version-update:semver-patch":
      return null;
    case "version-update:semver-minor": {
      const major = majorOf(dep.prevVersion);
      if (!Number.isFinite(major)) return `\`${name}\`: 更新前バージョンを判定できない`;
      if (major === 0)
        return `\`${name}\`: 0.x 系のマイナー更新(${dep.prevVersion} → ${dep.newVersion})`;
      if (exactPins.has(name))
        return `\`${name}\`: exact pin 対象のマイナー更新(${dep.prevVersion} → ${dep.newVersion})`;
      return null;
    }
    case "version-update:semver-major":
      return `\`${name}\`: メジャー更新(${dep.prevVersion} → ${dep.newVersion})`;
    default:
      return `\`${name}\`: 更新種別を判定できない(${dep.updateType ?? "不明"})`;
  }
}

function main() {
  const deps = JSON.parse(process.env.UPDATED_DEPENDENCIES_JSON || "[]");
  const exactPins = collectExactPins(process.cwd());
  const reasons =
    deps.length === 0
      ? ["更新対象の依存を取得できない"]
      : deps.map((dep) => manualReason(dep, exactPins)).filter((r) => r !== null);

  const decision = reasons.length === 0 ? "auto" : "manual";
  const reason = reasons.map((r) => `- ${r}`).join("\n");
  console.log(`decision=${decision}`);
  if (reason) console.log(reason);

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    appendFileSync(out, `decision=${decision}\n`);
    appendFileSync(out, `reason<<__EOF__\n${reason}\n__EOF__\n`);
  }
}

main();
