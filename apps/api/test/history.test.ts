import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  HISTORY_FULL_VERSIONS,
  HISTORY_MAX_VERSIONS,
  loadHistory,
  loadVersion,
  recordHistory,
  type HistoryEntryInput,
} from "../src/do/history";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asWriteResult } from "./rpc-unwrap";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

const T0 = Date.parse("2026-11-02T00:00:00.000Z");
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function entry(overrides: Partial<HistoryEntryInput> & { version: number }): HistoryEntryInput {
  return {
    recordId: uuid(1),
    kind: "write",
    status: "draft",
    data: { title: `v${overrides.version}` },
    fieldVersions: { title: overrides.version },
    actor: "user-a",
    via: "sync",
    ...overrides,
  };
}

// history.ts は SqlStorage だけに依存するので、マイグレーション済みの DO の sql を借りて直接呼ぶ
async function withSql(fn: (sql: SqlStorage) => void | Promise<void>): Promise<void> {
  const stub = freshStub();
  await stub.registerContentType(articleType(), auth("admin")); // マイグレーション適用のため一度起こす
  await runInDurableObject(stub, async (_instance, state) => {
    await fn(state.storage.sql);
  });
}

describe("recordHistory(16.5 / 決定 41: 区切りと畳み込み)", () => {
  it("同じ actor・via・status の連続した write は 15 分以内なら直前の版に畳み込む", async () => {
    await withSql((sql) => {
      const first = recordHistory(sql, at(0), entry({ version: 1 }));
      const second = recordHistory(sql, at(5 * MINUTE), entry({ version: 2 }));
      expect(second).toBe(first);
      const page = loadHistory(sql, uuid(1), { limit: 10 });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        version: 2,
        createdAt: at(0),
        updatedAt: at(5 * MINUTE),
      });
      expect(loadVersion(sql, uuid(1), first)?.data).toEqual({ title: "v2" });
    });
  });

  it("15 分を過ぎると新しい版を切る(起点は版を開いた時刻で、最後の更新ではない)", async () => {
    await withSql((sql) => {
      recordHistory(sql, at(0), entry({ version: 1 }));
      recordHistory(sql, at(14 * MINUTE), entry({ version: 2 }));
      const third = recordHistory(sql, at(16 * MINUTE), entry({ version: 3 }));
      expect(third).toBe(2);
    });
  });

  it("actor が変わる・via が変わる・status が変わると新しい版を切る", async () => {
    await withSql((sql) => {
      recordHistory(sql, at(0), entry({ version: 1 }));
      expect(recordHistory(sql, at(MINUTE), entry({ version: 2, actor: "user-b" }))).toBe(2);
      expect(
        recordHistory(sql, at(2 * MINUTE), entry({ version: 3, actor: "user-b", via: "mcp" })),
      ).toBe(3);
      expect(
        recordHistory(
          sql,
          at(3 * MINUTE),
          entry({ version: 4, actor: "user-b", via: "mcp", status: "in_review" }),
        ),
      ).toBe(4);
      // 畳み込まれなかった版の直後の write は、同じ条件ならまた畳み込まれる
      expect(
        recordHistory(
          sql,
          at(4 * MINUTE),
          entry({ version: 5, actor: "user-b", via: "mcp", status: "in_review" }),
        ),
      ).toBe(4);
    });
  });

  it("publish / unpublish / delete / restore は常に新しい版で、その直後の write も畳み込まない", async () => {
    await withSql((sql) => {
      recordHistory(sql, at(0), entry({ version: 1 }));
      expect(
        recordHistory(sql, at(MINUTE), entry({ version: 1, kind: "publish", sourceVersion: 1 })),
      ).toBe(2);
      expect(recordHistory(sql, at(2 * MINUTE), entry({ version: 2 }))).toBe(3);
      expect(
        recordHistory(sql, at(3 * MINUTE), entry({ version: 2, kind: "restore", restoredFrom: 1 })),
      ).toBe(4);
      expect(recordHistory(sql, at(4 * MINUTE), entry({ version: 2, kind: "delete" }))).toBe(5);
      expect(loadHistory(sql, uuid(1), { limit: 10 }).items.map((item) => item.kind)).toEqual([
        "delete",
        "restore",
        "write",
        "publish",
        "write",
      ]);
    });
  });

  it("changedFields は直前の版との差分(畳み込み時も、畳み込み先の 1 つ前の版と比べる)", async () => {
    await withSql((sql) => {
      recordHistory(sql, at(0), entry({ version: 1, data: { title: "a", body: "x" } }));
      recordHistory(sql, at(20 * MINUTE), entry({ version: 2, data: { title: "b", body: "x" } }));
      recordHistory(
        sql,
        at(21 * MINUTE),
        entry({ version: 3, data: { title: "b", body: "y", tag: "t" } }),
      );
      const items = loadHistory(sql, uuid(1), { limit: 10 }).items;
      // 版 2(v2 と v3 を畳み込み)は版 1 と比べるので title も含む。版 1 は初版なので全キー
      expect(items.map((item) => item.changedFields)).toEqual([
        ["body", "tag", "title"],
        ["body", "title"],
      ]);
    });
  });
});

describe("recordHistory(保持と差分圧縮)", () => {
  // 各版が別の版になるよう actor を交互に変える
  function manyVersions(
    sql: SqlStorage,
    count: number,
    kindAt: (i: number) => "write" | "publish" = () => "write",
  ) {
    for (let i = 1; i <= count; i++) {
      recordHistory(
        sql,
        at(i * MINUTE),
        entry({
          version: i,
          kind: kindAt(i),
          sourceVersion: kindAt(i) === "publish" ? i : undefined,
          actor: i % 2 === 0 ? "even" : "odd",
          data: { title: `v${i}`, [`f${i}`]: i },
        }),
      );
    }
  }

  it("11 版目を切ると最も古い版が逆差分になり、全文の版は直近 10 版だけになる", async () => {
    await withSql((sql) => {
      manyVersions(sql, HISTORY_FULL_VERSIONS + 1);
      const rows = sql
        .exec<{ history_seq: number; full: number }>(
          "SELECT history_seq, data IS NOT NULL AS full FROM record_history WHERE record_id = ? ORDER BY history_seq",
          uuid(1),
        )
        .toArray();
      expect(rows.filter((row) => row.full === 1)).toHaveLength(HISTORY_FULL_VERSIONS);
      expect(rows[0]).toEqual({ history_seq: 1, full: 0 });
      // 差分化された版も復元できる
      expect(loadVersion(sql, uuid(1), 1)?.data).toEqual({ title: "v1", f1: 1 });
      expect(loadVersion(sql, uuid(1), 2)?.data).toEqual({ title: "v2", f2: 2 });
    });
  });

  it("101 版目を切ると最も古い版が消える", async () => {
    await withSql((sql) => {
      manyVersions(sql, HISTORY_MAX_VERSIONS + 1);
      const seqs = loadHistory(sql, uuid(1), { limit: 200 }).items.map((item) => item.historySeq);
      expect(seqs).toHaveLength(HISTORY_MAX_VERSIONS);
      expect(seqs[seqs.length - 1]).toBe(2);
      expect(loadVersion(sql, uuid(1), 1)).toBeNull();
      expect(loadVersion(sql, uuid(1), 2)?.data).toEqual({ title: "v2", f2: 2 });
    });
  });

  it("120 版の中の publish 版は保持上限を越えても残り、全文のまま。全ての版が復元できる", async () => {
    await withSql((sql) => {
      manyVersions(sql, 120, (i) => (i === 5 || i === 60 ? "publish" : "write"));
      const items = loadHistory(sql, uuid(1), { limit: 200 }).items;
      expect(items).toHaveLength(HISTORY_MAX_VERSIONS + 1);
      expect(
        items.filter((item) => item.kind === "publish").map((item) => item.historySeq),
      ).toEqual([60, 5]);
      const pinned = sql
        .exec<{ data: string | null }>(
          "SELECT data FROM record_history WHERE record_id = ? AND history_seq = 5",
          uuid(1),
        )
        .one();
      expect(pinned.data).not.toBeNull();
      for (const item of items) {
        const version = loadVersion(sql, uuid(1), item.historySeq);
        expect(version?.data).toEqual({
          title: `v${item.version}`,
          [`f${item.version}`]: item.version,
        });
      }
    });
  });

  it("365 日より古い版は消える(publish 版は残る)", async () => {
    await withSql((sql) => {
      recordHistory(sql, at(0), entry({ version: 1, actor: "a" }));
      recordHistory(sql, at(MINUTE), entry({ version: 1, kind: "publish", sourceVersion: 1 }));
      recordHistory(sql, at(2 * MINUTE), entry({ version: 2, actor: "b" }));
      recordHistory(sql, at(366 * DAY), entry({ version: 3, actor: "c" }));
      expect(loadHistory(sql, uuid(1), { limit: 10 }).items.map((item) => item.historySeq)).toEqual(
        [4, 2],
      );
      expect(loadVersion(sql, uuid(1), 2)?.data).toEqual({ title: "v1" });
    });
  });

  it("loadHistory は新しい順にページングし、cursor は最後の history_seq", async () => {
    await withSql((sql) => {
      manyVersions(sql, 5);
      const first = loadHistory(sql, uuid(1), { limit: 2 });
      expect(first.items.map((item) => item.historySeq)).toEqual([5, 4]);
      expect(first.nextCursor).toBe("4");
      const second = loadHistory(sql, uuid(1), { limit: 2, cursor: first.nextCursor });
      expect(second.items.map((item) => item.historySeq)).toEqual([3, 2]);
      const last = loadHistory(sql, uuid(1), { limit: 2, cursor: second.nextCursor });
      expect(last.items.map((item) => item.historySeq)).toEqual([1]);
      expect(last.nextCursor).toBeNull();
    });
  });
});

describe("compareVersions", () => {
  it("追加・削除・変更をキー順に返し、同じ値は含めない", () => {
    expect(
      compareVersions(
        { a: 1, b: { x: 1, y: 2 }, c: "gone" },
        { a: 1, b: { y: 2, x: 1 }, d: "new" },
      ),
    ).toEqual([
      { key: "c", before: "gone", after: undefined },
      { key: "d", before: undefined, after: "new" },
    ]);
  });
});

describe("writeRecord が履歴を記録する", () => {
  it("作成と更新が record_history に入り、applied: false の書き込みは記録しない", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
    const params = { recordId: uuid(10), input: validArticleInput() };
    expect(asWriteResult(await stub.writeRecord("article", params, auth("user-a"))).ok).toBe(true);
    // 同じ内容をもう一度(applied: false)
    const again = asWriteResult(await stub.writeRecord("article", params, auth("user-a")));
    expect(again.ok && !again.applied).toBe(true);
    // 別の actor で更新 → 新しい版
    expect(
      asWriteResult(
        await stub.writeRecord(
          "article",
          { recordId: uuid(10), input: { ...validArticleInput(), title: "改題" } },
          auth("user-b"),
        ),
      ).ok,
    ).toBe(true);
    await runInDurableObject(stub, (_instance, state) => {
      const items = loadHistory(state.storage.sql, uuid(10), { limit: 10 }).items;
      expect(items.map((item) => [item.historySeq, item.actor, item.via, item.version])).toEqual([
        [2, "user-b", "rest", 2],
        [1, "user-a", "rest", 1],
      ]);
      expect(items[0]?.changedFields).toEqual(["title"]);
      expect(loadVersion(state.storage.sql, uuid(10), 1)?.data["title"]).toBe(
        validArticleInput()["title"],
      );
    });
  });
});
