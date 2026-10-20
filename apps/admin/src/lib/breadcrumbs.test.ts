import { expect, it } from "vitest";
import { contentTypeCrumb, currentCrumb, homeCrumb, settingsCrumb } from "./breadcrumbs";

it("各段の href は tenantSlug 配下、現在地は href を持たない", () => {
  expect(homeCrumb("blog")).toEqual({ id: "home", label: "ホーム", href: "/t/blog" });
  expect(contentTypeCrumb("blog", { key: "booking.slot", name: "予約枠" })).toEqual({
    id: "type:booking.slot",
    label: "予約枠",
    href: "/t/blog/content/booking.slot",
  });
  expect(settingsCrumb("blog")).toEqual({
    id: "settings",
    label: "設定",
    href: "/t/blog/settings/content-types",
  });
  expect(currentCrumb("編集")).toEqual({ id: "current", label: "編集" });
});
