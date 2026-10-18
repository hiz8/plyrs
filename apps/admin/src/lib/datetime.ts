// 案 H 5 章: 7 日以内は相対表記、それより前は日時。相対表記にはツールチップで日時を添えるため、
// 両方を返す。タイムゾーンはブラウザの設定に従い、書式は ja に固定する
// (timeZone はテスト用に差し替えられるようにする)。
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

// 一覧の行ごとに呼ばれるため、Intl のインスタンスは timeZone ごとに使い回す
const absoluteFormats = new Map<string, Intl.DateTimeFormat>();
const dayPartFormats = new Map<string, Intl.DateTimeFormat>();

function cached(
  cache: Map<string, Intl.DateTimeFormat>,
  timeZone: string | undefined,
  create: () => Intl.DateTimeFormat,
): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let format = cache.get(key);
  if (format === undefined) {
    format = create();
    cache.set(key, format);
  }
  return format;
}

// 「昨日」だけ auto で出し、それ以外は数値にする(auto のままだと 2 日前が「一昨日」になる)
const relativeAuto = new Intl.RelativeTimeFormat("ja", { numeric: "auto" });
const relativeNumeric = new Intl.RelativeTimeFormat("ja", { numeric: "always" });

export function formatAbsolute(date: Date, timeZone?: string): string {
  // ja-JP の 2-digit 指定で「2026/10/17 10:00」の形になる
  return cached(
    absoluteFormats,
    timeZone,
    () =>
      new Intl.DateTimeFormat("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone,
      }),
  ).format(date);
}

// timeZone での暦日を通し番号にする(24 時間以上前の日数は、経過時間ではなく日付の境目で数える)
function dayNumber(date: Date, timeZone: string | undefined): number {
  const parts = cached(
    dayPartFormats,
    timeZone,
    () =>
      new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        timeZone,
      }),
  ).formatToParts(date);
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
  const hours = () => relativeNumeric.format(-Math.floor(elapsed / HOUR), "hour");
  if (elapsed < HOUR) {
    return { text: relativeNumeric.format(-Math.floor(elapsed / MINUTE), "minute"), absolute, iso };
  }
  if (elapsed < DAY) {
    return { text: hours(), absolute, iso };
  }
  const days = dayNumber(now, options.timeZone) - dayNumber(date, options.timeZone);
  if (days <= 0) {
    // 夏時間で 25 時間ある日は、24 時間以上たっても暦日が同じになる(「今日」と出さない)
    return { text: hours(), absolute, iso };
  }
  if (days === 1) {
    return { text: relativeAuto.format(-1, "day"), absolute, iso };
  }
  if (days < RELATIVE_DAYS_LIMIT) {
    return { text: relativeNumeric.format(-days, "day"), absolute, iso };
  }
  return { text: absolute, absolute, iso };
}
