import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@plyrs/metamodel";
import {
  applyBlockPatch,
  blockPatchOf,
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

  it("提案から来た版(proposalId 付き)は畳み込まず、その直後の write も畳み込まない(M5c)", async () => {
    await withSql((sql) => {
      expect(recordHistory(sql, at(0), entry({ version: 1, proposalId: uuid(11) }))).toBe(1);
      // 同じ人が 15 分以内に別の提案を採用しても別の版
      expect(recordHistory(sql, at(MINUTE), entry({ version: 2, proposalId: uuid(12) }))).toBe(2);
      // 採用の直後の通常の編集も、採用の版には畳み込まない
      expect(recordHistory(sql, at(2 * MINUTE), entry({ version: 3 }))).toBe(3);
      // 通常の編集どうしは従来どおり畳み込む
      expect(recordHistory(sql, at(3 * MINUTE), entry({ version: 4 }))).toBe(3);
      const items = loadHistory(sql, uuid(1), { limit: 10 }).items;
      expect(items.map((item) => item.proposalId)).toEqual([null, uuid(12), uuid(11)]);
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

// 決定 53(M5a-1): リッチテキストの逆差分をブロック単位にする
function para(id: string | undefined, text: string) {
  return {
    type: "paragraph",
    ...(id === undefined ? {} : { attrs: { id } }),
    content: [{ type: "text", text }],
  };
}

function envelope(blocks: unknown[]) {
  return { schemaVersion: 2, doc: { type: "doc", content: blocks } };
}

const LONG = "長い段落の本文。".repeat(40);

function tenParagraphs(change: (i: number) => string = () => "") {
  return envelope(Array.from({ length: 10 }, (_, i) => para(`b${i}`, `${LONG}${i}${change(i)}`)));
}

function roundTrips(older: unknown, newer: unknown): void {
  const patch = blockPatchOf(older, newer);
  expect(patch).not.toBeNull();
  if (patch === null) {
    return;
  }
  expect(canonicalJson(applyBlockPatch(newer, JSON.parse(JSON.stringify(patch))))).toBe(
    canonicalJson(older),
  );
}

describe("blockPatchOf / applyBlockPatch(決定 53)", () => {
  it("10 段落の 3 段落目だけを変えると ref 9 個 + node 1 個になり、当てると古い版に戻る", () => {
    const older = tenParagraphs();
    const newer = tenParagraphs((i) => (i === 2 ? "(改稿)" : ""));
    const patch = blockPatchOf(older, newer);
    expect(patch?.content.filter((item) => "ref" in item)).toHaveLength(9);
    expect(patch?.content.filter((item) => "node" in item)).toHaveLength(1);
    expect(patch?.content[2]).toEqual({ node: older.doc.content[2] });
    roundTrips(older, newer);
  });

  it("段落の挿入・削除・並べ替えでも戻る", () => {
    const base = tenParagraphs();
    const blocks = base.doc.content;
    // 挿入(新しい側に b10 がある)
    roundTrips(base, envelope([...blocks.slice(0, 3), para("b10", "挿入"), ...blocks.slice(3)]));
    // 削除(新しい側から b4 が消えた)
    roundTrips(base, envelope(blocks.filter((_, i) => i !== 4)));
    // 並べ替え
    roundTrips(base, envelope([...blocks].reverse()));
  });

  it("新しい側に重複 ID・ID の無いブロックがある、エンベロープでない、null のとき null", () => {
    const older = tenParagraphs();
    const newer = tenParagraphs((i) => (i === 0 ? "x" : ""));
    const dup = envelope([...newer.doc.content, para("b1", "重複")]);
    expect(blockPatchOf(older, dup)).toBeNull();
    const noId = envelope([...newer.doc.content, para(undefined, "ID 無し")]);
    expect(blockPatchOf(older, noId)).toBeNull();
    expect(blockPatchOf("旧い文字列", newer)).toBeNull();
    expect(blockPatchOf(older, "新しい文字列")).toBeNull();
    expect(blockPatchOf(null, newer)).toBeNull();
    expect(blockPatchOf(older, null)).toBeNull();
    expect(blockPatchOf({ schemaVersion: 1, doc: { type: "doc" } }, newer)).toBeNull();
  });

  it("短くならない(全部のブロックが変わった)ときは null", () => {
    const older = envelope([para("a", "x")]);
    const newer = envelope([para("a", "y")]);
    expect(blockPatchOf(older, newer)).toBeNull();
  });

  it("参照先のブロックが無ければ applyBlockPatch は null", () => {
    const patch = { base: { schemaVersion: 2, doc: { type: "doc" } }, content: [{ ref: "zz" }] };
    expect(applyBlockPatch(tenParagraphs(), patch)).toBeNull();
  });
});

describe("recordHistory と loadVersion(ブロック単位の逆差分、決定 53)", () => {
  it("12 版を書いてから全版を読むと、書いた data と正規化 JSON で一致する", async () => {
    await withSql((sql) => {
      const written: Record<string, unknown>[] = [];
      let paragraphs = Array.from({ length: 10 }, (_, i) => para(`b${i}`, `${LONG}${i}`));
      for (let v = 1; v <= 12; v++) {
        let data: Record<string, unknown>;
        if (v === 6) {
          data = { title: `t${v}` }; // 本文の削除
        } else if (v === 4) {
          data = { title: `t${v}`, body: envelope(paragraphs) }; // タイトルだけの変更(本文は v3 と同じ)
        } else {
          paragraphs = paragraphs.map((block, i) =>
            i === v % 10 ? para(`b${i}`, `${LONG}${i}-v${v}`) : block,
          );
          if (v === 9) {
            paragraphs = [para("n9", "挿入"), ...paragraphs.slice(1)]; // 先頭の差し替え
          }
          data = { title: v === 3 ? "t2" : `t${v}`, body: envelope(paragraphs) };
        }
        written.push(data);
        recordHistory(
          sql,
          at(v * 20 * MINUTE),
          entry({ version: v, data, actor: v % 2 === 0 ? "even" : "odd" }),
        );
      }
      const diffs = sql
        .exec<{ diff: string | null }>(
          "SELECT diff FROM record_history WHERE record_id = ? AND diff IS NOT NULL",
          uuid(1),
        )
        .toArray();
      expect(diffs).toHaveLength(2);
      for (let seq = 1; seq <= 12; seq++) {
        expect(canonicalJson(loadVersion(sql, uuid(1), seq)?.data)).toBe(
          canonicalJson(written[seq - 1]),
        );
      }
    });
  });

  it("差分化した版の本文は blocks で持つ(set に本文全体を入れない)", async () => {
    await withSql((sql) => {
      for (let v = 1; v <= HISTORY_FULL_VERSIONS + 1; v++) {
        recordHistory(
          sql,
          at(v * 20 * MINUTE),
          entry({
            version: v,
            actor: v % 2 === 0 ? "even" : "odd",
            data: { title: "t", body: tenParagraphs((i) => (i === v % 10 ? `-v${v}` : "")) },
          }),
        );
      }
      const row = sql
        .exec<{ diff: string }>(
          "SELECT diff FROM record_history WHERE record_id = ? AND history_seq = 1",
          uuid(1),
        )
        .one();
      const diff = JSON.parse(row.diff) as { set: object; blocks?: Record<string, unknown> };
      expect(diff.set).toEqual({});
      expect(Object.keys(diff.blocks ?? {})).toEqual(["body"]);
    });
  });

  it("M4 の形の {set, unset} だけの行を含む鎖でも読める", async () => {
    await withSql((sql) => {
      for (let v = 1; v <= 3; v++) {
        recordHistory(
          sql,
          at(v * 20 * MINUTE),
          entry({
            version: v,
            actor: v % 2 === 0 ? "even" : "odd",
            data: { title: `t${v}`, body: tenParagraphs((i) => (i === v ? `-v${v}` : "")) },
          }),
        );
      }
      // 版 1・2 を M4 の形の逆差分に書き換える(デプロイ前に作られた行)
      const v1 = { title: "t1", body: tenParagraphs((i) => (i === 1 ? "-v1" : "")) };
      const v2 = { title: "t2", body: tenParagraphs((i) => (i === 2 ? "-v2" : "")) };
      sql.exec(
        "UPDATE record_history SET data = NULL, diff = ? WHERE record_id = ? AND history_seq = 2",
        JSON.stringify({ set: v2, unset: [] }),
        uuid(1),
      );
      sql.exec(
        "UPDATE record_history SET data = NULL, diff = ? WHERE record_id = ? AND history_seq = 1",
        JSON.stringify({ set: { title: "t1", body: v1.body }, unset: [] }),
        uuid(1),
      );
      expect(canonicalJson(loadVersion(sql, uuid(1), 1)?.data)).toBe(canonicalJson(v1));
      expect(canonicalJson(loadVersion(sql, uuid(1), 2)?.data)).toBe(canonicalJson(v2));
    });
  });

  it("当てられないブロックの参照を含む行があれば loadVersion は null", async () => {
    await withSql((sql) => {
      recordHistory(sql, at(0), entry({ version: 1, data: { body: tenParagraphs() } }));
      recordHistory(
        sql,
        at(20 * MINUTE),
        entry({ version: 2, actor: "b", data: { body: tenParagraphs() } }),
      );
      sql.exec(
        "UPDATE record_history SET data = NULL, diff = ? WHERE record_id = ? AND history_seq = 1",
        JSON.stringify({
          set: {},
          unset: [],
          blocks: { body: { base: { doc: { type: "doc" } }, content: [{ ref: "missing" }] } },
        }),
        uuid(1),
      );
      expect(loadVersion(sql, uuid(1), 1)).toBeNull();
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
