import { describe, expect, it } from "vitest";
import { normalizeForSearch, searchText } from "./search";

describe("searchText", () => {
  it("文字列はそのまま返す", () => {
    expect(searchText("お知らせ")).toBe("お知らせ");
    expect(searchText("")).toBe("");
  });

  it("JSON として読まれた ?q=2026 や ?q=true は文字列に戻す", () => {
    expect(searchText(2026)).toBe("2026");
    expect(searchText(true)).toBe("true");
    expect(searchText(false)).toBe("false");
  });

  it("検索語として扱えない値は空文字にする", () => {
    expect(searchText(undefined)).toBe("");
    expect(searchText(null)).toBe("");
    expect(searchText({ q: "x" })).toBe("");
    expect(searchText(["x"])).toBe("");
  });
});

describe("normalizeForSearch", () => {
  it("全角・半角の違いをなくす(NFKC)", () => {
    expect(normalizeForSearch("ＡＢＣ１２３")).toBe("abc123");
    expect(normalizeForSearch("ｶﾀｶﾅ")).toBe("カタカナ");
  });

  it("大文字・小文字の違いをなくす", () => {
    expect(normalizeForSearch("Hello World")).toBe("hello world");
  });
});
