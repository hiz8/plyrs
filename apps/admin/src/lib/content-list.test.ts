import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it, vi } from "vitest";
import {
  applyListQuery,
  buildListRows,
  DEFAULT_LIST_QUERY,
  filterRows,
  paginate,
  parseListQuery,
  publicationStateOf,
  runBulk,
  sortRows,
  tabCounts,
  toListSearch,
  type ListRow,
} from "./content-list";

function record(id: string, overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id,
    type: "article",
    input: { title: id },
    fieldVersions: {},
    status: "draft",
    seq: 1,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-10-01T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

function titleOf(r: SyncRecord): string {
  return String(r.input["title"] ?? "");
}

function rows(records: SyncRecord[], published: Record<string, number> = {}): ListRow[] {
  const publications = new Map(
    Object.entries(published).map(([id, sourceVersion]) => [id, { sourceVersion }]),
  );
  return buildListRows(records, publications, titleOf);
}

function ids(list: ListRow[], q: Partial<typeof DEFAULT_LIST_QUERY>): string[] {
  return filterRows(list, { ...DEFAULT_LIST_QUERY, ...q }).map((r) => r.record.id);
}

describe("publicationStateOf", () => {
  it("derives unpublished / published / changed from versions", () => {
    expect(publicationStateOf({ version: 3 }, undefined)).toBe("unpublished");
    expect(publicationStateOf({ version: 3 }, { sourceVersion: 3 })).toBe("published");
    expect(publicationStateOf({ version: 4 }, { sourceVersion: 3 })).toBe("changed");
  });
});

describe("tabs and filters", () => {
  const all = rows(
    [
      record("draft"),
      record("pub", { status: "ready", version: 2 }),
      record("changed", { status: "in_review", version: 5 }),
      record("archived-pub", { status: "archived", version: 2 }),
      record("archived", { status: "archived" }),
      record("gone", { deletedAt: "2026-10-02T00:00:00Z" }),
    ],
    { pub: 2, changed: 4, "archived-pub": 2 },
  );

  it("drops tombstones", () => {
    expect(all.map((r) => r.record.id)).not.toContain("gone");
  });

  it("counts each tab", () => {
    expect(tabCounts(all)).toStrictEqual({
      all: 3,
      published: 2,
      "unpublished-changes": 1,
      unpublished: 1,
      archived: 2,
    });
  });

  it("filters by tab, status and title", () => {
    expect(ids(all, { tab: "all" })).toStrictEqual(["draft", "pub", "changed"]);
    // アーカイブ済みは公開中でも「アーカイブ」タブにだけ出る(案 D 3.2)
    expect(ids(all, { tab: "published" })).toStrictEqual(["pub", "changed"]);
    expect(ids(all, { tab: "archived" })).toStrictEqual(["archived-pub", "archived"]);
    expect(ids(all, { tab: "unpublished" })).toStrictEqual(["draft"]);
    expect(ids(all, { status: "ready" })).toStrictEqual(["pub"]);
    expect(ids(all, { q: " CHAN " })).toStrictEqual(["changed"]);
  });

  it("matches titles ignoring full-width / half-width differences", () => {
    const jp = rows([record("a", { input: { title: "ＡＢＣのお知らせ" } })]);
    expect(filterRows(jp, { ...DEFAULT_LIST_QUERY, q: "abc" })).toHaveLength(1);
  });
});

describe("sortRows", () => {
  const list = rows([
    record("1", { input: { title: "いちご" }, updatedAt: "2026-10-02T00:00:00Z" }),
    record("2", { input: { title: "アボカド" }, updatedAt: "2026-10-03T00:00:00Z" }),
    record("3", { input: { title: "うどん" }, updatedAt: "2026-10-01T00:00:00Z" }),
  ]);

  it("sorts by updatedAt", () => {
    expect(sortRows(list, "updated", "desc").map((r) => r.record.id)).toStrictEqual([
      "2",
      "1",
      "3",
    ]);
    expect(sortRows(list, "updated", "asc").map((r) => r.record.id)).toStrictEqual(["3", "1", "2"]);
  });

  it("sorts titles in Japanese order regardless of kana type", () => {
    expect(sortRows(list, "title", "asc").map((r) => r.title)).toStrictEqual([
      "アボカド",
      "いちご",
      "うどん",
    ]);
  });

  it("breaks ties by id", () => {
    const tied = rows([record("b"), record("a")]);
    expect(sortRows(tied, "updated", "asc").map((r) => r.record.id)).toStrictEqual(["a", "b"]);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 45 }, (_, i) => i);

  it("slices the requested page", () => {
    expect(paginate(items, 3, 20)).toStrictEqual({
      items: [40, 41, 42, 43, 44],
      page: 3,
      pageCount: 3,
      total: 45,
    });
  });

  it("clamps an out-of-range page to the last page", () => {
    expect(paginate(items, 9, 20).page).toBe(3);
    expect(paginate([], 2, 20)).toStrictEqual({ items: [], page: 1, pageCount: 1, total: 0 });
  });
});

describe("URL query", () => {
  it("parses the default query from an empty search", () => {
    expect(parseListQuery({})).toStrictEqual(DEFAULT_LIST_QUERY);
  });

  it("round-trips a non-default query", () => {
    const search = { tab: "unpublished-changes", status: "draft", page: 2 };
    expect(toListSearch(parseListQuery(search))).toStrictEqual(search);
    const full = {
      tab: "archived",
      status: "ready",
      q: "春",
      sort: "title",
      order: "desc",
      page: 3,
      perPage: 100,
    };
    expect(toListSearch(parseListQuery(full))).toStrictEqual(full);
  });

  it("falls back to defaults for hand-edited invalid values", () => {
    expect(
      parseListQuery({ tab: "x", status: "archived", page: "0", perPage: "30", order: "up" }),
    ).toStrictEqual(DEFAULT_LIST_QUERY);
    expect(parseListQuery({ page: "2", perPage: "50" })).toMatchObject({ page: 2, perPage: 50 });
  });

  it("uses each sort's own default order", () => {
    expect(parseListQuery({ sort: "title" }).order).toBe("asc");
    expect(toListSearch({ sort: "title", order: "asc" })).toStrictEqual({ sort: "title" });
    // 並び順を省いたら、その並べ替えの既定とみなす
    expect(toListSearch({ sort: "title" })).toStrictEqual({ sort: "title" });
    expect(toListSearch({ sort: "title", order: "desc" })).toStrictEqual({
      sort: "title",
      order: "desc",
    });
  });

  it("keeps a numeric- or boolean-looking search term from a hand-written link", () => {
    expect(parseListQuery({ q: 2026 }).q).toBe("2026");
    expect(parseListQuery({ q: true }).q).toBe("true");
    expect(parseListQuery({ q: { x: 1 } }).q).toBe("");
  });
});

describe("applyListQuery", () => {
  it("filters, sorts, pages and counts over all rows", () => {
    const list = rows(
      Array.from({ length: 25 }, (_, i) =>
        record(String(i).padStart(2, "0"), {
          updatedAt: `2026-10-01T00:${String(i).padStart(2, "0")}:00Z`,
        }),
      ),
    );
    const view = applyListQuery(list, { ...DEFAULT_LIST_QUERY, page: 2 });
    expect(view.items.map((r) => r.record.id)).toStrictEqual(["04", "03", "02", "01", "00"]);
    expect(view.counts.all).toBe(25);
    expect(view.pageCount).toBe(2);
  });
});

describe("runBulk", () => {
  it("runs sequentially, continues after failures and reports progress", async () => {
    const order: string[] = [];
    const progress = vi.fn();
    const boom = new Error("boom");
    const result = await runBulk(
      ["a", "b", "c"],
      async (id) => {
        order.push(id);
        if (id === "b") {
          throw boom;
        }
      },
      progress,
    );
    expect(order).toStrictEqual(["a", "b", "c"]);
    expect(result).toStrictEqual({ succeeded: ["a", "c"], failed: [{ id: "b", cause: boom }] });
    expect(progress.mock.calls).toStrictEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("does not start the next item before the previous one settles", async () => {
    let running = 0;
    let maxRunning = 0;
    await runBulk(["a", "b", "c"], async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await Promise.resolve();
      running -= 1;
    });
    expect(maxRunning).toBe(1);
  });
});
