import type { ContentTypeDefinition, WorkflowStatus } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it } from "vitest";
import {
  countByStatus,
  countChanged,
  countMyDrafts,
  homeRecords,
  homeTypes,
  listHref,
  myDrafts,
  newRecordHref,
  recentUpdates,
  recordHref,
} from "./home";

function type(
  key: string,
  name: string,
  source: "user" | "plugin" | "system" = "user",
  menuOrder?: number,
): ContentTypeDefinition {
  return {
    id: `id-${key}`,
    key,
    name,
    source,
    version: 1,
    ...(source === "plugin" ? { pluginId: key.split(".")[0] } : {}),
    ...(menuOrder === undefined ? {} : { menuOrder }),
    fields: [{ key: "title", type: "text", required: true }],
  } as ContentTypeDefinition;
}

function rec(id: string, typeKey: string, over: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id,
    type: typeKey,
    input: { title: id },
    fieldVersions: {},
    status: "draft" as WorkflowStatus,
    seq: 1,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    updatedBy: "u1",
    ...over,
  } as SyncRecord;
}

const titleOf = (r: SyncRecord) => r.id;
const types = [
  type("article", "記事", "user", 1),
  type("page", "固定ページ", "user", 0),
  type("asset", "アセット", "system"),
  type("booking.slot", "予約枠", "plugin"),
  type("off.thing", "無効", "plugin"),
];
const modules = [
  { moduleId: "booking", name: "予約", enabled: true, navTypes: ["booking.slot", "article"] },
  { moduleId: "off", name: "無効", enabled: false, navTypes: ["off.thing"] },
];

describe("home", () => {
  it("homeTypes は利用者の型を menuOrder 順、続けて有効なモジュールの navTypes の順に並べる", () => {
    expect(homeTypes(types, modules)).toStrictEqual([
      { key: "page", name: "固定ページ", group: "content" },
      { key: "article", name: "記事", group: "content" },
      { key: "booking.slot", name: "予約枠", group: "module" },
    ]);
  });

  it("homeTypes は modules が未取得なら利用者の型だけを返す", () => {
    expect(homeTypes(types, undefined).map((t) => t.key)).toStrictEqual(["page", "article"]);
  });

  const ht = homeTypes(types, modules);

  it("homeRecords はサイドバーに出ない型と削除済みを除き、更新日時の新しい順に並べる", () => {
    const rows = homeRecords(
      [
        rec("a", "article", { updatedAt: "2026-10-02T00:00:00.000Z" }),
        rec("b", "asset", { updatedAt: "2026-10-09T00:00:00.000Z" }),
        rec("c", "off.thing", { updatedAt: "2026-10-09T00:00:00.000Z" }),
        rec("d", "page", {
          updatedAt: "2026-10-09T00:00:00.000Z",
          deletedAt: "2026-10-10T00:00:00.000Z",
        }),
        rec("e", "page", { updatedAt: "2026-10-03T00:00:00.000Z" }),
        rec("f", "booking.slot", { updatedAt: "2026-10-03T00:00:00.000Z" }),
      ],
      ht,
      titleOf,
    );
    expect(rows.map((r) => r.record.id)).toStrictEqual(["f", "e", "a"]);
    expect(rows[0]?.type.group).toBe("module");
    expect(rows[0]?.title).toBe("f");
  });

  const many = homeRecords(
    [
      ...["1", "2", "3", "4", "5", "6"].map((n) =>
        rec(`m${n}`, "article", { updatedAt: `2026-10-0${n}T00:00:00.000Z` }),
      ),
      rec("other", "article", { updatedBy: "u2", updatedAt: "2026-10-09T00:00:00.000Z" }),
      rec("rev", "article", { status: "in_review", updatedAt: "2026-10-09T00:00:00.000Z" }),
    ],
    ht,
    titleOf,
  );

  it("myDrafts は自分が最後に編集した下書きだけを 5 件まで返す", () => {
    expect(myDrafts(many, "u1").map((r) => r.record.id)).toStrictEqual([
      "m6",
      "m5",
      "m4",
      "m3",
      "m2",
    ]);
    expect(myDrafts(many, "u1", 2)).toHaveLength(2);
  });

  it("recentUpdates は新しい順に limit 件(既定 10)まで返す", () => {
    expect(recentUpdates(many)).toHaveLength(8);
    expect(recentUpdates(many, 3).map((r) => r.record.id)).toStrictEqual(["rev", "other", "m6"]);
  });

  it("countByStatus は型をまたいで数え、byType は homeTypes の順で 0 件の型を含まない", () => {
    const rows = homeRecords(
      [
        rec("a", "article", { status: "in_review" }),
        rec("b", "page", { status: "in_review" }),
        rec("c", "page", { status: "in_review" }),
        rec("d", "booking.slot", { status: "ready" }),
      ],
      ht,
      titleOf,
    );
    const summary = countByStatus(rows, "in_review", ht);
    expect(summary.total).toBe(3);
    expect(summary.byType.map((t) => [t.type.key, t.count])).toStrictEqual([
      ["page", 2],
      ["article", 1],
    ]);
    expect(countByStatus(rows, "archived", ht)).toStrictEqual({ total: 0, byType: [] });
    expect(countMyDrafts(many, "u1", ht).total).toBe(6);
  });

  it("countChanged は公開中かつ sourceVersion が古いものだけを数える", () => {
    const rows = homeRecords(
      [
        rec("a", "article", { version: 3 }),
        rec("b", "article", { version: 2 }),
        rec("c", "page", { version: 5 }),
      ],
      ht,
      titleOf,
    );
    const publications = new Map([
      ["a", { sourceVersion: 2 }],
      ["b", { sourceVersion: 2 }],
    ]);
    const summary = countChanged(rows, publications, ht);
    expect(summary.total).toBe(1);
    expect(summary.byType.map((t) => [t.type.key, t.count])).toStrictEqual([["article", 1]]);
  });

  it("listHref は既定値を省いたクエリを付け、空なら ? を付けない", () => {
    expect(listHref("blog", "article", { status: "in_review" })).toBe(
      "/t/blog/content/article?status=in_review",
    );
    expect(listHref("blog", "article", { tab: "unpublished-changes" })).toBe(
      "/t/blog/content/article?tab=unpublished-changes",
    );
    expect(listHref("blog", "article", {})).toBe("/t/blog/content/article");
  });

  it("recordHref / newRecordHref", () => {
    expect(recordHref("blog", "article", "r1")).toBe("/t/blog/content/article/r1");
    expect(newRecordHref("blog", "article")).toBe("/t/blog/content/article/new");
  });
});
