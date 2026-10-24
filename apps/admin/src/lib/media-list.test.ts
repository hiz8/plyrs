import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it } from "vitest";
import type { ResolvedUsage } from "./media";
import {
  DEFAULT_MEDIA_QUERY,
  MEDIA_VIEW_STORAGE_KEY,
  applyMediaQuery,
  buildMediaRows,
  formatBytes,
  hasMediaFilters,
  inUseCount,
  mediaKindOf,
  parseMediaQuery,
  readMediaView,
  saveMediaView,
  toMediaSearch,
  uploadedAtOf,
  usageTitles,
} from "./media-list";

function asset(id: string, input: Record<string, unknown>, deletedAt: string | null = null) {
  return {
    id,
    type: "asset",
    input,
    fieldVersions: {},
    status: "draft",
    seq: 1,
    version: 1,
    deletedAt,
    updatedAt: "2026-10-01T00:00:00.000Z",
    updatedBy: "u",
  } satisfies SyncRecord;
}

const ID_A = "018f2b6a-7a0a-7000-8000-000000000e01";
const ID_B = "018f2b6a-7a0b-7000-8000-000000000e02";
const ID_C = "018f2b6a-7a0c-7000-8000-000000000e03";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

const throwing: Storage = {
  length: 0,
  clear: () => undefined,
  key: () => null,
  getItem: () => {
    throw new Error("denied");
  },
  removeItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

describe("mediaKindOf", () => {
  it("MIME の先頭で 5 種に分ける", () => {
    expect(mediaKindOf("image/png")).toBe("image");
    expect(mediaKindOf("application/pdf")).toBe("pdf");
    expect(mediaKindOf("video/mp4")).toBe("video");
    expect(mediaKindOf("audio/mpeg")).toBe("audio");
    expect(mediaKindOf("text/csv")).toBe("other");
    expect(mediaKindOf("")).toBe("other");
  });
});

describe("parseMediaQuery / toMediaSearch", () => {
  it("不正な値を既定に戻し、既定値は URL から省く", () => {
    expect(parseMediaQuery({})).toStrictEqual(DEFAULT_MEDIA_QUERY);
    expect(parseMediaQuery({ kind: "gif", usage: "unused", q: 2026, sort: "name" })).toStrictEqual({
      kind: "all",
      usage: "unused",
      q: "2026",
      sort: "name",
    });
    expect(parseMediaQuery({ kind: "pdf", usage: "x", sort: "x", q: {} })).toStrictEqual({
      kind: "pdf",
      usage: "all",
      q: "",
      sort: "newest",
    });
    expect(toMediaSearch({ kind: "image", q: "" })).toStrictEqual({ kind: "image" });
    expect(toMediaSearch({})).toStrictEqual({});
    expect(toMediaSearch({ kind: "all", usage: "unused", q: "a", sort: "name" })).toStrictEqual({
      usage: "unused",
      q: "a",
      sort: "name",
    });
  });

  it("hasMediaFilters は既定と違えば true", () => {
    expect(hasMediaFilters(DEFAULT_MEDIA_QUERY)).toBe(false);
    expect(hasMediaFilters({ ...DEFAULT_MEDIA_QUERY, q: "a" })).toBe(true);
    expect(hasMediaFilters({ ...DEFAULT_MEDIA_QUERY, kind: "pdf" })).toBe(true);
    expect(hasMediaFilters({ ...DEFAULT_MEDIA_QUERY, usage: "unused" })).toBe(true);
    // 並び順は絞り込みではない
    expect(hasMediaFilters({ ...DEFAULT_MEDIA_QUERY, sort: "name" })).toBe(false);
  });
});

describe("uploadedAtOf", () => {
  it("UUIDv7 の時刻部を返し、形が違えば null", () => {
    expect(uploadedAtOf(ID_A)).toStrictEqual(new Date(0x018f2b6a7a0a));
    expect(uploadedAtOf("abc")).toBeNull();
    expect(uploadedAtOf("zzzzzzzz-zzzz-7000-8000-000000000000")).toBeNull();
  });
});

describe("buildMediaRows", () => {
  it("削除済みを除き、input の型が合わない値を既定にする", () => {
    const rows = buildMediaRows([
      asset(ID_A, {
        filename: "photo.final.JPEG",
        content_type: "image/jpeg",
        size: 2048,
        width: 640,
        height: 480,
        alt: "海",
        caption: "夏",
      }),
      asset(ID_B, { filename: 3, content_type: null, size: "big", width: "x", alt: 1 }),
      asset(ID_C, { filename: "gone.png" }, "2026-10-02T00:00:00.000Z"),
    ]);
    expect(rows.map((row) => row.id)).toStrictEqual([ID_A, ID_B]);
    expect(rows[0]).toMatchObject({
      filename: "photo.final.JPEG",
      contentType: "image/jpeg",
      kind: "image",
      size: 2048,
      width: 640,
      height: 480,
      alt: "海",
      caption: "夏",
      extension: "JPEG",
      uploadedAt: new Date(0x018f2b6a7a0a),
    });
    expect(rows[1]).toMatchObject({
      filename: "",
      contentType: "",
      kind: "other",
      size: 0,
      width: null,
      height: null,
      alt: "",
      caption: "",
      extension: "?",
    });
  });
});

const ids = (list: readonly { id: string }[]) => list.map((row) => row.id);

describe("applyMediaQuery", () => {
  const rows = buildMediaRows([
    asset(ID_A, { filename: "Banner.png", content_type: "image/png", size: 1, alt: "春の告知" }),
    asset(ID_B, { filename: "guide.pdf", content_type: "application/pdf", size: 1 }),
    asset(ID_C, { filename: "ａｌｐｈａ.png", content_type: "image/png", size: 1 }),
    asset("not-a-uuid", { filename: "legacy.png", content_type: "image/png", size: 1 }),
  ]);

  it("既定は新しい順で、時刻が読めない行は末尾", () => {
    expect(ids(applyMediaQuery(rows, DEFAULT_MEDIA_QUERY, null))).toStrictEqual([
      ID_C,
      ID_B,
      ID_A,
      "not-a-uuid",
    ]);
  });

  it("種類で絞る", () => {
    expect(ids(applyMediaQuery(rows, { ...DEFAULT_MEDIA_QUERY, kind: "pdf" }, null))).toStrictEqual(
      [ID_B],
    );
  });

  it("未使用は orphanIds で絞り、orphanIds が null なら無視する", () => {
    const query = { ...DEFAULT_MEDIA_QUERY, usage: "unused" } as const;
    expect(ids(applyMediaQuery(rows, query, new Set([ID_A])))).toStrictEqual([ID_A]);
    expect(applyMediaQuery(rows, query, null)).toHaveLength(4);
  });

  it("検索は大文字小文字・全角半角を無視し、代替テキストも見る", () => {
    expect(
      ids(applyMediaQuery(rows, { ...DEFAULT_MEDIA_QUERY, q: " BANNER " }, null)),
    ).toStrictEqual([ID_A]);
    expect(ids(applyMediaQuery(rows, { ...DEFAULT_MEDIA_QUERY, q: "ALPHA" }, null))).toStrictEqual([
      ID_C,
    ]);
    expect(ids(applyMediaQuery(rows, { ...DEFAULT_MEDIA_QUERY, q: "春" }, null))).toStrictEqual([
      ID_A,
    ]);
  });

  it("ファイル名順は数字を数として比べ、同点は id 降順", () => {
    const named = buildMediaRows([
      asset(ID_A, { filename: "img10.png" }),
      asset(ID_B, { filename: "img2.png" }),
      asset(ID_C, { filename: "img2.png" }),
    ]);
    expect(
      ids(applyMediaQuery(named, { ...DEFAULT_MEDIA_QUERY, sort: "name" }, null)),
    ).toStrictEqual([ID_C, ID_B, ID_A]);
  });

  it("ファイル名順は大文字小文字の違いを Collator の既定で並べる", () => {
    // id 降順なら ID_C(大文字)が先になるが、Collator の既定では小文字が先
    const cased = buildMediaRows([
      asset(ID_A, { filename: "b.png" }),
      asset(ID_B, { filename: "B.png" }),
      asset(ID_C, { filename: "a.png" }),
    ]);
    expect(
      applyMediaQuery(cased, { ...DEFAULT_MEDIA_QUERY, sort: "name" }, null).map(
        (row) => row.filename,
      ),
    ).toStrictEqual(["a.png", "b.png", "B.png"]);
  });
});

describe("formatBytes", () => {
  it("B / KB / MB を小数 1 桁で表す", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("readMediaView / saveMediaView", () => {
  it("既定は grid で、保存した list を読み戻す", () => {
    const storage = memoryStorage();
    expect(readMediaView(storage)).toBe("grid");
    saveMediaView("list", storage);
    expect(storage.getItem(MEDIA_VIEW_STORAGE_KEY)).toBe("list");
    expect(readMediaView(storage)).toBe("list");
    expect(readMediaView(memoryStorage({ [MEDIA_VIEW_STORAGE_KEY]: "x" }))).toBe("grid");
  });

  it("localStorage の例外に耐える", () => {
    expect(readMediaView(throwing)).toBe("grid");
    expect(() => saveMediaView("list", throwing)).not.toThrow();
  });
});

const usage = (recordId: string, title: string): ResolvedUsage => ({
  recordId,
  typeKey: "article",
  typeName: "記事",
  title,
  fieldKey: "f",
  origin: "relation",
  place: "p",
});

describe("usageTitles / inUseCount", () => {
  it("重複を除いて 3 件までと残りの件数を返す", () => {
    expect(
      usageTitles([
        usage("1", "a"),
        usage("1", "a"),
        usage("2", "b"),
        usage("3", "c"),
        usage("4", "d"),
        usage("5", "e"),
      ]),
    ).toStrictEqual({ titles: "a、b、c", rest: 2 });
    expect(usageTitles([usage("1", "a")])).toStrictEqual({ titles: "a", rest: 0 });
    expect(usageTitles([])).toStrictEqual({ titles: "", rest: 0 });
  });

  it("inUseCount は未使用に無い件数", () => {
    expect(inUseCount(["a", "b", "c"], new Set(["b"]))).toBe(2);
    expect(inUseCount([], new Set())).toBe(0);
  });
});
