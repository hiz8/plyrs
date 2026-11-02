import { describe, expect, it } from "vitest";
import { markdownToRichText, richTextToMarkdown } from "@plyrs/richtext";

// M2-2(M0-2 結果の引き継ぎ 2): @tiptap/markdown(marked)と @tiptap/pm のスキーマ検証が
// workerd 上(@cloudflare/vitest-plugin、DOM 無し)で動くことを固定する。M1-6 の serialize は
// 動いていたので、ここで新しく確かめるのは parse と Node.check()
describe("@plyrs/richtext on workerd", () => {
  it("Markdown → AST → Markdown が往復する", () => {
    const parsed = markdownToRichText("# 見出し\n\n本文と **太字**");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.schemaVersion).toBe(2);
    expect(richTextToMarkdown(parsed.envelope)).toBe("# 見出し\n\n本文と **太字**");
  });

  it("語彙外の構文は業務エラーになる", () => {
    expect(markdownToRichText("| a |\n| - |")).toMatchObject({
      ok: false,
      code: "unsupported_markdown",
    });
  });
});
