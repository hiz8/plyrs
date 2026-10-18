import { describe, expect, it } from "vitest";
import { legacyPathname } from "./legacy-redirect";

describe("legacyPathname (案 A 6 章)", () => {
  it.each([
    ["/t/blog/records/article", "/t/blog/content/article"],
    ["/t/blog/records/article/new", "/t/blog/content/article/new"],
    ["/t/blog/assets", "/t/blog/media"],
    ["/t/blog/content-types", "/t/blog/settings/content-types"],
    ["/t/blog/content-types/article/edit", "/t/blog/settings/content-types/article/edit"],
    ["/t/blog/modules", "/t/blog/settings/modules"],
  ])("%s → %s", (from, to) => {
    expect(legacyPathname(from)).toBe(to);
  });

  it.each([
    "/t/blog",
    "/t/blog/",
    "/t/blog/content/article",
    "/t/blog/settings/modules",
    "/t/blog/media",
    "/tenants",
  ])("%s は旧パスではない", (pathname) => {
    expect(legacyPathname(pathname)).toBeNull();
  });
});
