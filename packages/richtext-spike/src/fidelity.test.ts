// M0-2 の本体: Tiptap の全ノード種を
//   (a) ProseMirror JSON + attrs.id(= 形式は変えず ID だけ足す)
//   (b) Portable Text(HTML 経由)
//   (c) Markdown(@tiptap/markdown)
// に往復させ、不可逆になる箇所を一覧にする。結果は RESULTS.md / results.json に書き出す。
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import type { RichTextEnvelope } from "@plyrs/metamodel";
import { ensureTopLevelBlockIds } from "./block-ids";
import { fixtures } from "./fixtures";
import { fromMarkdown, toMarkdown, toMarkdownStatic } from "./markdown";
import { describeDiff, normalize } from "./normalize";
import { portableTextToTiptap, tiptapToPortableText } from "./portable-text";
import { getSchema } from "@tiptap/core";
import { plyrsExtensions } from "./extensions";

// 比較の前に ProseMirror のスキーマを通す: attrs の既定値(link の target / rel など)が埋まり、
// スキーマに合わない構造は例外になる(= 変換結果がエディタで開けることの確認にもなる)
const schema = getSchema(plyrsExtensions());
function canon(doc: JSONContent): JSONContent {
  return normalize(schema.nodeFromJSON(doc).toJSON() as JSONContent);
}

interface RowResult {
  name: string;
  note: string;
  pmId: "○";
  portableText: "○" | "×";
  portableTextDiff: string[];
  markdown: "○" | "×";
  markdownDiff: string[];
  markdownText: string;
  markdownStaticSame: boolean;
  portableTextJson: unknown;
}

const rows: RowResult[] = [];

describe("変換忠実度(往復)", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const original = canon(fixture.doc);

      // (a) ID を振って外すだけなので構造は不変。確認は「ID が付いた」ことだけ
      const withIds = ensureTopLevelBlockIds({ schemaVersion: 1, doc: fixture.doc } as RichTextEnvelope);
      expect(withIds.envelope.doc.content!.every((b) => typeof b.attrs?.["id"] === "string")).toBe(true);
      expect(canon(withIds.envelope.doc)).toEqual(original);

      // (b) Portable Text
      const pt = tiptapToPortableText(fixture.doc);
      const fromPt = canon(portableTextToTiptap(pt));
      const ptDiff = describeDiff(original, fromPt);

      // (c) Markdown
      const md = toMarkdown(fixture.doc);
      const fromMd = canon(fromMarkdown(md));
      const mdDiff = describeDiff(original, fromMd);
      let mdStaticSame = false;
      try {
        mdStaticSame = toMarkdownStatic(fixture.doc) === md;
      } catch {
        mdStaticSame = false;
      }

      rows.push({
        name: fixture.name,
        note: fixture.note,
        pmId: "○",
        portableText: ptDiff.length === 0 ? "○" : "×",
        portableTextDiff: ptDiff,
        markdown: mdDiff.length === 0 ? "○" : "×",
        markdownDiff: mdDiff,
        markdownText: md,
        markdownStaticSame: mdStaticSame,
        portableTextJson: pt,
      });
    });
  }

  it("結果を書き出す", () => {
    mkdirSync("results", { recursive: true });
    writeFileSync("results/results.json", JSON.stringify(rows, null, 2));
    const lines = [
      "# 変換忠実度の結果(自動生成: src/fidelity.test.ts)",
      "",
      "○ = 往復で意味が同じ(ブロック ID と null の attrs は無視)、× = 不可逆。差分は最初の数件。",
      "",
      "| ノード種 | 説明 | (a) PM JSON + id | (b) Portable Text | (c) Markdown |",
      "| --- | --- | --- | --- | --- |",
      ...rows.map(
        (r) =>
          `| ${r.name} | ${r.note} | ${r.pmId} | ${r.portableText}${fmt(r.portableTextDiff)} | ${r.markdown}${fmt(r.markdownDiff)} |`,
      ),
      "",
      "## Markdown 出力(@tiptap/markdown の serialize)",
      "",
      ...rows.flatMap((r) => [`### ${r.name}`, "", "```markdown", r.markdownText, "```", r.markdownStaticSame ? "(static-renderer の renderToMarkdown と同一)" : "(static-renderer の renderToMarkdown とは不一致)", ""]),
    ];
    writeFileSync("RESULTS.md", lines.join("\n"));
    expect(rows.length).toBe(fixtures.length);
  });
});

function fmt(diff: string[]): string {
  return diff.length === 0 ? "" : `<br>${diff.map((d) => `\`${d.replace(/\|/g, "\\|")}\``).join("<br>")}`;
}
