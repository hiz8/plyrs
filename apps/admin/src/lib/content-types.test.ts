import { describe, expect, it } from "vitest";
import type { SyncRecord } from "@plyrs/sync-protocol";
import type { ContentTypeSummary } from "./admin-api";
import {
  menuOrderUpdates,
  pluginTypeGroups,
  referenceCandidates,
  userTypeRows,
} from "./content-types";

function row(overrides: Partial<ContentTypeSummary> & { key: string }): ContentTypeSummary {
  return {
    id: `id-${overrides.key}`,
    name: overrides.key,
    fields: [],
    source: "user",
    pluginId: null,
    createdAt: "2026-07-17T00:00:00Z",
    updatedAt: "2026-07-17T00:00:00Z",
    version: 1,
    description: null,
    titleField: null,
    listColumns: null,
    menuOrder: null,
    ...overrides,
  };
}

function rec(type: string, deletedAt: string | null = null): SyncRecord {
  return {
    id: crypto.randomUUID(),
    type,
    input: {},
    fieldVersions: {},
    status: "draft",
    seq: 1,
    version: 1,
    deletedAt,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u",
  };
}

describe("userTypeRows", () => {
  const types = [
    row({ key: "b", name: "B", menuOrder: 1 }),
    row({ key: "a", name: "A", menuOrder: 0 }),
    row({ key: "asset", name: "アセット", source: "system" }),
    row({ key: "mod.x", name: "X", source: "plugin", pluginId: "mod" }),
  ];

  it("利用者の型を menuOrder 順にし、同期前は count null で canDelete false", () => {
    const rows = userTypeRows(types, [], false);
    expect(rows.map((r) => r.row.key)).toStrictEqual(["a", "b"]);
    expect(rows.every((r) => r.count === null && !r.canDelete)).toBe(true);
  });

  it("同期後に削除済みを除いて数え、0 件だけ canDelete", () => {
    const rows = userTypeRows(
      types,
      [rec("a"), rec("a"), rec("a", "2026-07-18T00:00:00Z"), rec("b", "2026-07-18T00:00:00Z")],
      true,
    );
    expect(rows.map((r) => [r.row.key, r.count, r.canDelete])).toStrictEqual([
      ["a", 2, false],
      ["b", 0, true],
    ]);
  });
});

describe("pluginTypeGroups", () => {
  const types = [
    row({ key: "booking.slot", name: "枠", source: "plugin", pluginId: "booking" }),
    row({ key: "booking.reservation", name: "予約", source: "plugin", pluginId: "booking" }),
    row({ key: "booking.zzz", name: "ああ", source: "plugin", pluginId: "booking" }),
    row({ key: "forms.entry", name: "回答", source: "plugin", pluginId: "forms" }),
    row({ key: "asset", name: "アセット", source: "system" }),
    row({ key: "news", name: "お知らせ" }),
  ];
  const modules = [
    { moduleId: "forms", name: "フォーム", navTypes: ["forms.entry"] },
    { moduleId: "booking", name: "予約", navTypes: ["booking.slot", "booking.reservation"] },
  ];

  it("pluginId で分け、modules の名前と navTypes の順を使い、システム型を出さない", () => {
    const groups = pluginTypeGroups(types, modules, [rec("booking.slot")], true);
    expect(groups.map((g) => [g.pluginId, g.name])).toStrictEqual([
      ["forms", "フォーム"],
      ["booking", "予約"],
    ]);
    expect(groups[1]?.rows.map((r) => r.row.key)).toStrictEqual([
      "booking.slot",
      "booking.reservation",
      "booking.zzz",
    ]);
    expect(groups[1]?.rows[0]).toMatchObject({ count: 1, canDelete: false });
  });

  it("modules が取れないときは pluginId を名前にする", () => {
    const groups = pluginTypeGroups(types, undefined, [], false);
    expect(groups.map((g) => [g.pluginId, g.name])).toStrictEqual([
      ["booking", "booking"],
      ["forms", "forms"],
    ]);
    expect(groups[0]?.rows[0]?.count).toBeNull();
  });
});

describe("menuOrderUpdates", () => {
  it("index と違う行だけ menuOrder 付きの定義にする", () => {
    const updates = menuOrderUpdates([
      row({ key: "a", menuOrder: 0 }),
      row({ key: "b", menuOrder: 5 }),
      row({ key: "c" }),
    ]);
    expect(updates.map((u) => [u.key, u.menuOrder])).toStrictEqual([
      ["b", 1],
      ["c", 2],
    ]);
    expect(updates[0]).not.toHaveProperty("createdAt");
  });
});

describe("referenceCandidates", () => {
  it("自分自身と asset を除く", () => {
    const types = [
      row({ key: "news", name: "お知らせ" }),
      row({ key: "blog", name: "ブログ" }),
      row({ key: "asset", name: "アセット", source: "system" }),
      row({ key: "mod.x", name: "X", source: "plugin", pluginId: "mod" }),
    ];
    expect(referenceCandidates(types, "news").map((c) => c.key)).toStrictEqual(["blog", "mod.x"]);
    expect(referenceCandidates(types, null).map((c) => c.key)).toContain("news");
  });
});
