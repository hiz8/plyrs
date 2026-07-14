import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

describe("keyset cursor codec (裁定 2026-07-14: 無署名 base64url)", () => {
  it("round-trips string, number, and unicode sort keys", () => {
    const cases = [
      { k: "2026-07-14T00:00:00.000Z", id: "018f2b6a-7a0a-7000-8000-000000000001" },
      { k: 42.5, id: "r2" },
      { k: "日本語のタイトル", id: "r3" },
      { k: null, id: "r4" },
    ];
    for (const payload of cases) {
      expect(decodeCursor(encodeCursor(payload))).toStrictEqual(payload);
    }
  });

  it("emits url-safe tokens (no +, /, =)", () => {
    const token = encodeCursor({ k: "a?b&c=d/e+f", id: "r1" });
    expect(token).not.toMatch(/[+/=]/u);
  });

  it("rejects garbage, non-json, and wrong shapes with null (caller turns it into 400)", () => {
    expect(decodeCursor("%%%not-base64%%%")).toBeNull();
    expect(decodeCursor(btoa("not json"))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify(["k", "id"])))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ k: "x" })))).toBeNull(); // id 欠落
    expect(decodeCursor(btoa(JSON.stringify({ k: { nested: true }, id: "r" })))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ k: "x", id: 7 })))).toBeNull(); // id が非文字列
    expect(decodeCursor("")).toBeNull();
  });

  it("caps token length (defense against abuse)", () => {
    expect(decodeCursor("A".repeat(600))).toBeNull();
  });
});
