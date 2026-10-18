import { describe, expect, it } from "vitest";
import { formatAbsolute, formatDateTime } from "./datetime";

const TZ = "Asia/Tokyo";
// 2026-10-17 10:00 JST
const NOW = new Date("2026-10-17T01:00:00Z");

function textAt(iso: string): string {
  return formatDateTime(iso, { now: NOW, timeZone: TZ }).text;
}

describe("formatDateTime", () => {
  it("1 分未満は「たった今」", () => {
    expect(textAt("2026-10-17T00:59:30Z")).toBe("たった今");
  });

  it("端末の時計のずれによる 1 分未満の未来も「たった今」", () => {
    expect(textAt("2026-10-17T01:00:30Z")).toBe("たった今");
  });

  it("1 時間未満は分で表す", () => {
    expect(textAt("2026-10-17T00:50:00Z")).toBe("10 分前");
  });

  it("24 時間未満は時間で表す(日付をまたいでも「昨日」にしない)", () => {
    expect(textAt("2026-10-16T22:00:00Z")).toBe("3 時間前");
    // 2026-10-16 23:30 JST → 10 時間 30 分前
    expect(textAt("2026-10-16T14:30:00Z")).toBe("10 時間前");
  });

  it("24 時間以上前で前日の日付なら「昨日」", () => {
    // 2026-10-16 09:00 JST
    expect(textAt("2026-10-16T00:00:00Z")).toBe("昨日");
  });

  it("7 日未満は日数で表す(2 日前も「一昨日」にしない)", () => {
    expect(textAt("2026-10-15T01:00:00Z")).toBe("2 日前");
    expect(textAt("2026-10-14T01:00:00Z")).toBe("3 日前");
    expect(textAt("2026-10-11T01:00:00Z")).toBe("6 日前");
  });

  it("夏時間の 25 時間の日は、24 時間以上たっても同じ日付なら時間で表す", () => {
    // America/New_York の 2026-11-01 は夏時間の終わりで 25 時間ある。
    // 00:00 EDT(04:00Z)から 23:30 EST(翌 04:30Z)までは 24.5 時間だが暦日は同じ
    const text = formatDateTime("2026-11-01T04:00:00Z", {
      now: new Date("2026-11-02T04:30:00Z"),
      timeZone: "America/New_York",
    }).text;
    expect(text).toBe("24 時間前");
  });

  it("7 日以上前は日時で表す", () => {
    expect(textAt("2026-10-10T01:00:00Z")).toBe("2026/10/10 10:00");
  });

  it("1 分以上先の未来は日時で表す", () => {
    expect(textAt("2026-10-17T02:00:00Z")).toBe("2026/10/17 11:00");
  });

  it("相対表記でもツールチップ用の日時と ISO を返す", () => {
    expect(formatDateTime("2026-10-17T00:50:00Z", { now: NOW, timeZone: TZ })).toEqual({
      text: "10 分前",
      absolute: "2026/10/17 09:50",
      iso: "2026-10-17T00:50:00.000Z",
    });
  });

  it("Date と数値も受け付ける", () => {
    const date = new Date("2026-10-17T00:50:00Z");
    expect(formatDateTime(date, { now: NOW, timeZone: TZ }).text).toBe("10 分前");
    expect(formatDateTime(date.getTime(), { now: NOW, timeZone: TZ }).text).toBe("10 分前");
  });

  it("解釈できない値で例外を投げない", () => {
    expect(formatDateTime("not a date", { now: NOW, timeZone: TZ })).toEqual({
      text: "—",
      absolute: "—",
      iso: "",
    });
  });
});

describe("formatAbsolute", () => {
  it("タイムゾーンに従い 24 時間制で表す", () => {
    expect(formatAbsolute(new Date("2026-10-17T15:05:00Z"), TZ)).toBe("2026/10/18 00:05");
    expect(formatAbsolute(new Date("2026-10-17T15:05:00Z"), "UTC")).toBe("2026/10/17 15:05");
  });
});
