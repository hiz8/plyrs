import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it } from "vitest";
import { formatCounts, moduleAddLinks, moduleContentCounts } from "./modules";
import type { NavType } from "./navigation";

let seq = 0;
function rec(type: string, deletedAt: string | null = null): SyncRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    type,
    input: {},
    fieldVersions: {},
    status: "draft",
    seq,
    version: 1,
    deletedAt,
    updatedAt: "2026-07-16T00:00:00Z",
    updatedBy: "u1",
  };
}

const types: NavType[] = [
  { key: "booking.slot", name: "予約枠", source: "plugin" },
  { key: "booking.reservation", name: "予約", source: "plugin" },
];

describe("modules", () => {
  it("moduleContentCounts は navTypes の順に削除済みを除いて数える", () => {
    const records = [
      rec("booking.reservation"),
      rec("booking.reservation"),
      rec("booking.reservation"),
      rec("booking.reservation", "2026-07-16T00:00:00Z"),
      rec("booking.slot"),
      rec("booking.slot"),
      rec("other"),
    ];
    expect(
      moduleContentCounts(records, ["booking.reservation", "booking.slot", "booking.x"], types),
    ).toEqual([
      { key: "booking.reservation", name: "予約", count: 3 },
      { key: "booking.slot", name: "予約枠", count: 2 },
      { key: "booking.x", name: "booking.x", count: 0 },
    ]);
  });

  it("formatCounts は「予約 3 件、予約枠 2 件」", () => {
    expect(
      formatCounts([
        { key: "a", name: "予約", count: 3 },
        { key: "b", name: "予約枠", count: 2 },
      ]),
    ).toBe("予約 3 件、予約枠 2 件");
  });

  it("moduleAddLinks は同期で届いている型だけ", () => {
    expect(moduleAddLinks(["booking.slot", "booking.none"], types, "blog")).toEqual([
      { key: "booking.slot", label: "予約枠を追加", href: "/t/blog/content/booking.slot/new" },
    ]);
  });
});
