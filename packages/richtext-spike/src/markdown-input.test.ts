// エージェントが書きそうな「スキーマ外の Markdown」を受け取ったときに何が起きるかを記録する。
// M2-2(Markdown ⇄ AST)の受け入れ方針を決める材料。結果は RESULTS-markdown-input.md に書く。
import { writeFileSync } from "node:fs";
import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { plyrsExtensions } from "./extensions";
import { fromMarkdown, toMarkdown } from "./markdown";

const schema = getSchema(plyrsExtensions());

const inputs: Array<{ name: string; md: string }> = [
  { name: "h4(語彙は h1〜h3)", md: "#### 深い見出し" },
  { name: "GFM テーブル", md: "| a | b |\n| --- | --- |\n| 1 | 2 |" },
  { name: "タスクリスト", md: "- [ ] todo\n- [x] done" },
  { name: "外部 URL の画像", md: "![alt](https://example.com/x.png)" },
  { name: "生の HTML ブロック", md: "<div class=\"x\">html</div>" },
  { name: "生のインライン HTML", md: "a <b>b</b> c" },
  { name: "脚注・自動リンク", md: "see https://example.com and [^1]\n\n[^1]: note" },
  { name: "空文字", md: "" },
  { name: "見出しの直後に続く段落(空行なし)", md: "# 題\n本文" },
  { name: "番号リスト 3 から", md: "3. 三\n4. 四" },
  { name: "ネストした引用", md: "> 外\n>\n> > 内" },
];

describe("スキーマ外の Markdown の受け入れ", () => {
  const rows: string[] = [];
  for (const input of inputs) {
    it(input.name, () => {
      const json = fromMarkdown(input.md);
      let validity = "スキーマ検証 OK";
      try {
        schema.nodeFromJSON(json).check();
      } catch (error) {
        validity = `スキーマ検証 NG: ${(error as Error).message}`;
      }
      const back = toMarkdown(json);
      rows.push(
        `| ${input.name} | \`${input.md.replace(/\n/g, "\\n").replace(/\|/g, "\\|")}\` | \`${JSON.stringify(json.content).replace(/\|/g, "\\|")}\` | ${validity} | \`${back.replace(/\n/g, "\\n").replace(/\|/g, "\\|")}\` |`,
      );
      expect(json.type).toBe("doc");
    });
  }
  it("結果を書き出す", () => {
    writeFileSync(
      "RESULTS-markdown-input.md",
      [
        "# スキーマ外の Markdown の受け入れ(自動生成: src/markdown-input.test.ts)",
        "",
        "| 入力 | Markdown | 得られた AST(content) | スキーマ検証 | 再出力 |",
        "| --- | --- | --- | --- | --- |",
        ...rows,
      ].join("\n"),
    );
  });
});
