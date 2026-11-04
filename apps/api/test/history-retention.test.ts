import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  HISTORY_FOLD_WINDOW_MS,
  HISTORY_FULL_VERSIONS,
  HISTORY_MAX_VERSIONS,
  recordHistory,
} from "../src/do/history";

// M4-6(決定 41 の実測): 5000 文字の記事を 15 分超の間隔で 300 回編集し、20 回の publish を挟む。
// 版の数が保持上限(100 + publish 版)を超えないことと、履歴の容量を出力する(報告書の表に写す)。
// 編集は現実の執筆に寄せて、10 段落(各 500 文字)のうち 1 段落だけを書き換える。
// M5a-1(決定 53)で逆差分をブロック単位にし、逆差分の合計の上限を足した。

const EDITS = 300;
const PUBLISH_EVERY = 15; // 300 / 15 = 20 回
const PARAGRAPHS = 10;
const PARAGRAPH_CHARS = 500;
const STEP_MS = HISTORY_FOLD_WINDOW_MS + 60_000;

function paragraph(seed: number): string {
  const base = `第${seed}稿の段落。`;
  return base.repeat(Math.ceil(PARAGRAPH_CHARS / base.length)).slice(0, PARAGRAPH_CHARS);
}

function documentOf(paragraphs: string[]) {
  return {
    title: "履歴の実測",
    body: {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: paragraphs.map((text, i) => ({
          type: "paragraph",
          attrs: { id: `b${i}` },
          content: [{ type: "text", text }],
        })),
      },
    },
  };
}

describe("履歴の保持(決定 41 の実測)", () => {
  it("300 回の編集と 20 回の publish で版の数が上限内に収まり、容量を出力する", async () => {
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(`history-retention-${Date.now()}`));
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      const sizeBefore = sql.databaseSize;
      const recordId = "01900000-0000-7000-8000-00000000a001";
      const paragraphs = Array.from({ length: PARAGRAPHS }, (_, i) => paragraph(i));
      let nowMs = Date.parse("2026-01-01T00:00:00Z");
      let version = 0;
      let publishes = 0;
      for (let edit = 1; edit <= EDITS; edit += 1) {
        paragraphs[edit % PARAGRAPHS] = paragraph(edit);
        version += 1;
        nowMs += STEP_MS;
        const data = documentOf(paragraphs);
        recordHistory(sql, new Date(nowMs).toISOString(), {
          recordId,
          kind: "write",
          version,
          status: "draft",
          data,
          fieldVersions: { title: 1, body: version },
          actor: "editor",
          via: "sync",
        });
        if (edit % PUBLISH_EVERY === 0) {
          publishes += 1;
          nowMs += 1000;
          recordHistory(sql, new Date(nowMs).toISOString(), {
            recordId,
            kind: "publish",
            version,
            sourceVersion: version,
            status: "draft",
            data,
            fieldVersions: { title: 1, body: version },
            actor: "owner",
            via: "rest",
          });
        }
      }
      const rows = sql
        .exec<{ kind: string; full: number; data_bytes: number; diff_bytes: number }>(
          `SELECT kind, data IS NOT NULL AS full,
                  coalesce(length(CAST(data AS BLOB)), 0) AS data_bytes,
                  coalesce(length(CAST(diff AS BLOB)), 0) AS diff_bytes
             FROM record_history WHERE record_id = ?`,
          recordId,
        )
        .toArray();
      const publishRows = rows.filter((row) => row.kind === "publish");
      const writeRows = rows.filter((row) => row.kind === "write");
      const report = {
        edits: EDITS,
        publishes,
        versions: rows.length,
        writeVersions: writeRows.length,
        publishVersions: publishRows.length,
        fullWriteVersions: writeRows.filter((row) => row.full === 1).length,
        dataBytes: rows.reduce((sum, row) => sum + row.data_bytes, 0),
        diffBytes: rows.reduce((sum, row) => sum + row.diff_bytes, 0),
        publishDataBytes: publishRows.reduce((sum, row) => sum + row.data_bytes, 0),
        databaseSizeDelta: sql.databaseSize - sizeBefore,
      };
      console.log(`history-retention ${JSON.stringify(report)}`);
      expect(publishRows).toHaveLength(publishes);
      expect(writeRows.length).toBeLessThanOrEqual(HISTORY_MAX_VERSIONS);
      expect(rows.length).toBeLessThanOrEqual(HISTORY_MAX_VERSIONS + publishes);
      // 直近 10 版は全文。publish 版を除く write の全文は HISTORY_FULL_VERSIONS 以下
      expect(report.fullWriteVersions).toBeLessThanOrEqual(HISTORY_FULL_VERSIONS);
      // 決定 53(M5a-1): 逆差分はブロック単位。M4 の 976 KB から 250 KB 未満に下がる
      expect(report.diffBytes).toBeLessThan(250 * 1024);
    });
  });
});
