import { describe, expect, it } from "vitest";
import { activeNavKey, moduleNavGroups, resolveNavHref, sidebarContentTypes } from "./navigation";

const t = (
  key: string,
  name: string,
  extra: Partial<{ source: "user" | "plugin" | "system"; menuOrder: number | null }> = {},
) => ({ key, name, source: "user", menuOrder: null, ...extra }) as const;

describe("sidebarContentTypes", () => {
  it("利用者の型だけを menuOrder → 名前の順に並べる", () => {
    const types = [
      t("blog", "ブログ"),
      t("asset", "メディア", { source: "system" }),
      t("event", "イベント", { menuOrder: 1 }),
      t("news", "お知らせ"),
      t("booking.slot", "予約枠", { source: "plugin" }),
    ];
    expect(sidebarContentTypes(types).map((x) => x.key)).toEqual(["event", "news", "blog"]);
  });
});

describe("moduleNavGroups", () => {
  const types = [
    t("booking.slot", "予約枠", { source: "plugin" }),
    t("booking.resource", "予約リソース", { source: "plugin" }),
  ];
  it("有効なモジュールの navTypes を、同期済みの型がある順で出す", () => {
    const modules = [
      {
        moduleId: "booking",
        name: "予約",
        enabled: true,
        navTypes: ["booking.resource", "booking.slot", "booking.reservation"],
      },
    ];
    expect(moduleNavGroups(modules, types)).toEqual([
      {
        moduleId: "booking",
        name: "予約",
        types: [
          { key: "booking.resource", name: "予約リソース" },
          { key: "booking.slot", name: "予約枠" },
        ],
      },
    ]);
  });
  it("無効なモジュールは出さず、同期済みの型に無い navTypes は出さない", () => {
    const modules = [
      { moduleId: "booking", name: "予約", enabled: false, navTypes: ["booking.slot"] },
      { moduleId: "shop", name: "店舗", enabled: true, navTypes: ["shop.item"] },
    ];
    expect(moduleNavGroups(modules, types)).toEqual([
      { moduleId: "shop", name: "店舗", types: [] },
    ]);
  });
});

describe("resolveNavHref", () => {
  it("$name をパラメータで置き換える", () => {
    expect(
      resolveNavHref("/t/$tenantSlug/content/$typeKey", {
        tenantSlug: "blog",
        typeKey: "booking.slot",
      }),
    ).toBe("/t/blog/content/booking.slot");
    expect(resolveNavHref("/t/$tenantSlug/modules/booking/$unknown", { tenantSlug: "blog" })).toBe(
      "/t/blog/modules/booking/$unknown",
    );
  });
});

describe("activeNavKey", () => {
  const entries = [
    { key: "home", href: "/t/blog" },
    { key: "type:news", href: "/t/blog/content/news" },
    { key: "media", href: "/t/blog/media" },
    { key: "settings", href: "/t/blog/settings/content-types", matchPrefix: "/t/blog/settings" },
  ];
  it.each([
    ["/t/blog", "home"],
    ["/t/blog/content/news", "type:news"],
    ["/t/blog/content/news/new", "type:news"],
    ["/t/blog/content/news/0190a1b2-c3d4-7000-8000-000000000001", "type:news"],
    ["/t/blog/content/newsletter", "home"],
    ["/t/blog/settings/modules", "settings"],
    ["/t/blog/settings", "settings"],
    ["/t/other/media", null],
  ])("%s → %s", (pathname, key) => {
    expect(activeNavKey(entries, pathname)).toBe(key);
  });
});

it("exact の項目は前方一致しない(同期前にホームが現在地にならない)", () => {
  const entries = [
    { key: "home", href: "/t/blog", exact: true },
    { key: "type:article", href: "/t/blog/content/article" },
  ];
  expect(activeNavKey(entries, "/t/blog/content/article")).toBe("type:article");
  expect(activeNavKey(entries, "/t/blog/media")).toBeNull();
  expect(activeNavKey(entries, "/t/blog")).toBe("home");
});
