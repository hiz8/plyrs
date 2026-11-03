import {
  isAgentAssetContentType,
  MAX_ASSET_FILENAME_LENGTH,
  MAX_ASSET_SIZE_BYTES,
  readCapped,
} from "./store";

// design-spec 16.11(M4-5、決定 52): URL からの画像の取り込み。Worker から任意の URL を取りに行くので、
// SSRF を次の規則で防ぐ(各ホップで同じ検査をする):
// - https: のみ、ポートは既定(443)のみ、URL に利用者名・パスワードを含めない
// - ホストが IP リテラルなら拒否する(私的・ループバック・リンクローカルを個別に判定しない。全部拒否)。
//   WHATWG の URL は 10 進や 16 進の IPv4 表記も 4 つ組に正規化するので、それも IP リテラルとして弾ける
// - localhost と .localhost / .local / .internal で終わる名前は拒否する(末尾のドットは外して見る)
// - redirect: "manual" で最大 3 回まで辿る。タイムアウト 10 秒、本文は読みながら 20 MiB で打ち切る
// - Content-Type は PNG / JPEG / GIF / WebP / AVIF のみ(SVG は不可)
// 実行時は互換フラグ global_fetch_strictly_public(M3-1 で有効化済み)が二重の防御になる
// (名前解決の結果が私的アドレスでも公開インターネットにしか出ない)。

export const MAX_IMPORT_REDIRECTS = 3;
export const IMPORT_TIMEOUT_MS = 10_000;

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal"];
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

export type FetchImageFailureCode =
  | "url_not_allowed"
  | "fetch_failed"
  | "too_large"
  | "unsupported_type";

export type FetchImageResult =
  | { ok: true; body: ArrayBuffer; contentType: string; filename: string }
  | { ok: false; code: FetchImageFailureCode; message: string };

function fail(code: FetchImageFailureCode, message: string): FetchImageResult {
  return { ok: false, code, message };
}

// 取りに行ってよい URL なら URL を、だめなら理由を返す
export function checkImportUrl(raw: string, base?: URL): URL | string {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol !== "https:") {
    return "only https URLs can be imported";
  }
  if (url.port !== "") {
    return "only the default port (443) is allowed";
  }
  if (url.username !== "" || url.password !== "") {
    return "URLs with credentials are not allowed";
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || IPV4_PATTERN.test(host)) {
    return "IP address hosts are not allowed; use a host name";
  }
  if (host === "localhost" || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return "local host names are not allowed";
  }
  return url;
}

function filenameOf(url: URL): string {
  const last = url.pathname.split("/").findLast((part) => part !== "") ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    decoded = last;
  }
  const name = decoded.trim();
  return name === "" ? "image" : name.slice(0, MAX_ASSET_FILENAME_LENGTH);
}

export async function fetchPublicImage(
  raw: string,
  fetcher: typeof fetch = fetch,
): Promise<FetchImageResult> {
  let checked = checkImportUrl(raw);
  const signal = AbortSignal.timeout(IMPORT_TIMEOUT_MS);
  for (let hop = 0; ; hop += 1) {
    if (typeof checked === "string") {
      return fail("url_not_allowed", checked);
    }
    const url = checked;
    let res: Response;
    try {
      res = await fetcher(url.href, { redirect: "manual", signal });
    } catch (error) {
      return fail("fetch_failed", `could not fetch the URL: ${(error as Error).message}`);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (location === null) {
        return fail("fetch_failed", `redirect ${res.status} without Location`);
      }
      if (hop >= MAX_IMPORT_REDIRECTS) {
        return fail("fetch_failed", `too many redirects (more than ${MAX_IMPORT_REDIRECTS})`);
      }
      checked = checkImportUrl(location, url);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      return fail("fetch_failed", `the URL responded with ${res.status}`);
    }
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (contentType === undefined || !isAgentAssetContentType(contentType)) {
      await res.body?.cancel();
      return fail(
        "unsupported_type",
        `unsupported content type "${contentType ?? ""}"; PNG / JPEG / GIF / WebP / AVIF only`,
      );
    }
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_ASSET_SIZE_BYTES) {
      await res.body?.cancel();
      return fail("too_large", `the image exceeds ${MAX_ASSET_SIZE_BYTES} bytes`);
    }
    let read: Awaited<ReturnType<typeof readCapped>>;
    try {
      read = await readCapped(res.body, MAX_ASSET_SIZE_BYTES);
    } catch (error) {
      return fail("fetch_failed", `could not read the body: ${(error as Error).message}`);
    }
    if (!read.ok) {
      return fail("too_large", `the image exceeds ${MAX_ASSET_SIZE_BYTES} bytes`);
    }
    if (read.body.byteLength === 0) {
      return fail("fetch_failed", "the URL returned an empty body");
    }
    return { ok: true, body: read.body, contentType, filename: filenameOf(url) };
  }
}
