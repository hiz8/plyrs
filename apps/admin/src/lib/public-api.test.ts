import { describe, expect, it } from "vitest";
import { publicApiBase, publicRecordsUrl, resolvePublicOrigin } from "./public-api";

describe("public-api", () => {
  it("publicApiBase と publicRecordsUrl は末尾の / を重ねない", () => {
    expect(publicApiBase("https://api.example/", "shop")).toBe(
      "https://api.example/public/v1/shop/",
    );
    expect(publicRecordsUrl("https://api.example", "shop", "news")).toBe(
      "https://api.example/public/v1/shop/records/news",
    );
    expect(resolvePublicOrigin("", "http://localhost:5173")).toBe("http://localhost:5173");
    expect(resolvePublicOrigin("https://api.example", "http://localhost:5173")).toBe(
      "https://api.example",
    );
  });
});
