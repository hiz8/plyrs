// 案 H 5 章: 7 日以内は相対表記、それより前は日時。相対表記にはツールチップで日時を添えるため、
// 両方を返す。タイムゾーンはブラウザの設定に従う(timeZone はテスト用に差し替えられるようにする)。
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RELATIVE_DAYS_LIMIT = 7;

export interface FormattedDateTime {
  // 画面に出す文字列(相対表記、または日時)
  text: string;
  // 日時の文字列(ツールチップと <time> の表示用)
  absolute: string;
  // <time dateTime> に入れる ISO 8601 文字列
  iso: string;
}

export interface FormatOptions {
  now?: Date;
  timeZone?: string;
}

export function formatAbsolute(date: Date, timeZone?: string): string {
  // ja-JP の 2-digit 指定で「2026/10/17 10:00」の形になる
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
}

// timeZone での暦日を通し番号にする(24 時間以上前の日数は、経過時間ではなく日付の境目で数える)
function dayNumber(date: Date, timeZone: string | undefined): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Math.round(Date.UTC(get("year"), get("month") - 1, get("day")) / DAY);
}

export function formatDateTime(
  value: Date | string | number,
  options: FormatOptions = {},
): FormattedDateTime {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    // 壊れた値で画面ごと落とさない(ISO 文字列はサーバー由来のため通常は起きない)
    return { text: "—", absolute: "—", iso: "" };
  }
  const now = options.now ?? new Date();
  const absolute = formatAbsolute(date, options.timeZone);
  const iso = date.toISOString();
  const elapsed = now.getTime() - date.getTime();

  // 端末の時計のずれで少し未来になった値も「たった今」に寄せる
  if (elapsed < MINUTE && elapsed > -MINUTE) {
    return { text: "たった今", absolute, iso };
  }
  if (elapsed < 0) {
    return { text: absolute, absolute, iso };
  }
  const rtf = new Intl.RelativeTimeFormat("ja", { numeric: "auto" });
  if (elapsed < HOUR) {
    return { text: rtf.format(-Math.floor(elapsed / MINUTE), "minute"), absolute, iso };
  }
  if (elapsed < DAY) {
    return { text: rtf.format(-Math.floor(elapsed / HOUR), "hour"), absolute, iso };
  }
  const days = dayNumber(now, options.timeZone) - dayNumber(date, options.timeZone);
  if (days < RELATIVE_DAYS_LIMIT) {
    // numeric: "auto" により 1 日前は「昨日」になる
    return { text: rtf.format(-days, "day"), absolute, iso };
  }
  return { text: absolute, absolute, iso };
}
