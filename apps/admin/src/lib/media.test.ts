import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it } from "vitest";
import {
  countUsingRecords,
  isTooLarge,
  MAX_UPLOAD_BYTES,
  resolveUsage,
  uploadFiles,
  uploadSummaryMessage,
  type UploadItem,
} from "./media";

function fileOf(name: string, size = 3): File {
  const file = new File([new Uint8Array(1)], name);
  // 20 MB の実バッファを作らずに大きさだけ偽る
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function statuses(items: readonly UploadItem[]): string[] {
  return items.map((item) => `${item.file.name}:${item.status}`);
}

describe("isTooLarge", () => {
  it("allows exactly 20 MB and rejects anything above", () => {
    expect(isTooLarge({ size: MAX_UPLOAD_BYTES })).toBe(false);
    expect(isTooLarge({ size: MAX_UPLOAD_BYTES + 1 })).toBe(true);
  });
});

describe("uploadFiles", () => {
  it("uploads one file at a time, skips oversized files and keeps going after a failure", async () => {
    const sent: string[] = [];
    const snapshots: string[][] = [];
    const boom = new Error("boom");
    const summary = await uploadFiles(
      [fileOf("a.png"), fileOf("huge.mov", MAX_UPLOAD_BYTES + 1), fileOf("b.png"), fileOf("c.png")],
      async (file) => {
        sent.push(file.name);
        if (file.name === "b.png") {
          throw boom;
        }
        return { id: `id-${file.name}` };
      },
      (items) => snapshots.push(statuses(items)),
    );
    expect(sent).toStrictEqual(["a.png", "b.png", "c.png"]);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(2);
    expect(summary.items).toStrictEqual([
      { file: expect.any(File), status: "done", assetId: "id-a.png" },
      { file: expect.any(File), status: "failed", reason: "too_large" },
      { file: expect.any(File), status: "failed", reason: "error", cause: boom },
      { file: expect.any(File), status: "done", assetId: "id-c.png" },
    ]);
    // 最初に全件を並べ、そのあと 1 件ずつ uploading → 結果 と進む
    expect(snapshots[0]).toStrictEqual([
      "a.png:queued",
      "huge.mov:failed",
      "b.png:queued",
      "c.png:queued",
    ]);
    expect(snapshots[1]).toStrictEqual([
      "a.png:uploading",
      "huge.mov:failed",
      "b.png:queued",
      "c.png:queued",
    ]);
    expect(snapshots.filter((s) => s.some((line) => line.endsWith(":uploading")))).toHaveLength(3);
    expect(
      snapshots.every((s) => s.filter((line) => line.endsWith(":uploading")).length <= 1),
    ).toBe(true);
  });
});

describe("uploadSummaryMessage", () => {
  it("separates successes and failures", () => {
    expect(uploadSummaryMessage({ succeeded: 3, failed: 0 })).toBe(
      "3 件のファイルをアップロードしました",
    );
    expect(uploadSummaryMessage({ succeeded: 0, failed: 2 })).toBe(
      "2 件のファイルをアップロードできませんでした",
    );
    expect(uploadSummaryMessage({ succeeded: 2, failed: 1 })).toBe(
      "2 件のファイルをアップロードしました。1 件はアップロードできませんでした",
    );
  });
});

const newsType: ContentTypeDefinition = {
  id: "c1",
  key: "news",
  name: "お知らせ",
  source: "user",
  version: 1,
  titleField: "headline",
  fields: [
    { key: "code", type: "text" },
    { key: "headline", type: "text", label: "見出し" },
    {
      key: "hero",
      type: "relation",
      label: "アイキャッチ",
      config: { allowedTypes: ["asset"], cardinality: "one" },
    },
    { key: "body", type: "richtext", label: "本文" },
    { key: "gallery", type: "relation", config: { allowedTypes: ["asset"], cardinality: "many" } },
  ],
};

function record(id: string, input: Record<string, unknown>): SyncRecord {
  return {
    id,
    type: "news",
    input,
    fieldVersions: {},
    status: "draft",
    seq: 1,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-10-17T00:00:00Z",
    updatedBy: "u1",
  };
}

describe("resolveUsage", () => {
  const records = new Map([
    ["r1-aaaaaaaa", record("r1-aaaaaaaa", { headline: "秋のキャンペーン", code: "X" })],
    ["r2-bbbbbbbb", record("r2-bbbbbbbb", { headline: "10 月の営業案内" })],
  ]);
  const lookup = (id: string) => records.get(id);

  it("shows the title, type name and field label instead of keys", () => {
    expect(
      resolveUsage(
        [
          { sourceId: "r1-aaaaaaaa", sourceType: "news", sourceField: "hero", origin: "field" },
          { sourceId: "r2-bbbbbbbb", sourceType: "news", sourceField: "body", origin: "body" },
        ],
        [newsType],
        lookup,
      ),
    ).toStrictEqual([
      {
        recordId: "r1-aaaaaaaa",
        typeKey: "news",
        typeName: "お知らせ",
        title: "秋のキャンペーン",
        fieldLabel: "アイキャッチ",
        place: "アイキャッチ",
      },
      {
        recordId: "r2-bbbbbbbb",
        typeKey: "news",
        typeName: "お知らせ",
        title: "10 月の営業案内",
        fieldLabel: "本文",
        place: "本文中",
      },
    ]);
  });

  it("merges repeated uses in the same field and falls back to keys and ids", () => {
    const resolved = resolveUsage(
      [
        { sourceId: "r1-aaaaaaaa", sourceType: "news", sourceField: "gallery", origin: "field" },
        { sourceId: "r1-aaaaaaaa", sourceType: "news", sourceField: "gallery", origin: "field" },
        { sourceId: "zz-unknown", sourceType: null, sourceField: "image", origin: "field" },
        { sourceId: "yy-old-type", sourceType: "legacy", sourceField: "img", origin: "field" },
      ],
      [newsType],
      lookup,
    );
    expect(resolved.map((u) => [u.title, u.typeName, u.place])).toStrictEqual([
      ["秋のキャンペーン", "お知らせ", "gallery"],
      ["zz-unkno", "不明な型", "image"],
      ["yy-old-t", "legacy", "img"],
    ]);
  });
});

describe("countUsingRecords", () => {
  it("counts distinct records, not relations", () => {
    expect(countUsingRecords([{ sourceId: "a" }, { sourceId: "a" }, { sourceId: "b" }])).toBe(2);
  });
});
