// oxlint.config.ts の依存ルール(no-restricted-imports)が、意図どおりに検出するかを確かめる。
// fixtures/ の各ファイルの import の行には、行末に「// NG」か「// OK」を書く。
//   NG: no-restricted-imports で検出されなければならない
//   OK: 検出されてはならない
// fixture のグロブの置き方は fixtures/fixture.config.ts を参照。
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures");
const RULE = "eslint(no-restricted-imports)";

interface Diagnostic {
  code: string;
  filename: string;
  labels: { span: { line: number } }[];
}

function lint(): Diagnostic[] {
  const args = ["-c", "fixture.config.ts", "-f", "json", "."];
  let stdout: string;
  try {
    stdout = execFileSync("oxlint", args, { cwd: FIXTURES, encoding: "utf8" });
  } catch (error) {
    // 検出があると終了コードが 0 以外になる。出力が JSON なら結果として読む
    const out = (error as { stdout?: string }).stdout;
    if (out === undefined || out === "") throw error;
    stdout = out;
  }
  return (JSON.parse(stdout) as { diagnostics: Diagnostic[] }).diagnostics;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(entry.name) && entry.name !== "fixture.config.ts" ? [path] : [];
  });
}

const flagged = new Set(
  lint()
    .filter((d) => d.code === RULE)
    .map((d) => `${relative(FIXTURES, join(FIXTURES, d.filename))}:${d.labels[0]?.span.line ?? 0}`),
);

const problems: string[] = [];
let checked = 0;
for (const file of filesUnder(FIXTURES)) {
  const rel = relative(FIXTURES, file);
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((text, i) => {
      if (!/^(import|export) .* from "|^import\("/.test(text)) return;
      const key = `${rel}:${i + 1}`;
      const marker = /\/\/ (NG|OK)\b/.exec(text)?.[1];
      checked += 1;
      if (marker === undefined) {
        problems.push(`${key}: 行末に // NG か // OK を書く`);
      } else if (marker === "NG" && !flagged.has(key)) {
        problems.push(`${key}: 検出されるはずの import が検出されなかった: ${text.trim()}`);
      } else if (marker === "OK" && flagged.has(key)) {
        problems.push(`${key}: 許可されるはずの import が検出された: ${text.trim()}`);
      }
    });
}

if (checked === 0) problems.push("fixture の import が 1 つも見つからない");

if (problems.length > 0) {
  console.error(`依存ルールの fixture と結果が一致しない(${problems.length} 件):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`依存ルールの fixture: ${checked} 件の import がすべて期待どおり`);
