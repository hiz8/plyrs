import { describe, expect, it, vi } from "vitest";
import { fetchPublicImage, MAX_IMPORT_REDIRECTS } from "../src/assets/fetch-url";
import { MAX_ASSET_SIZE_BYTES } from "../src/assets/store";

// M4-5(design-spec 16.11、決定 52): URL からの取り込みの SSRF 対策

const UA = "plyrs-asset-import/1 (+https://api.example)";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function png(headers: Record<string, string> = {}): Response {
  return new Response(PNG, { status: 200, headers: { "content-type": "image/png", ...headers } });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

function fetcherOf(...responses: Response[]) {
  const fn = vi.fn<typeof fetch>();
  for (const res of responses) {
    fn.mockResolvedValueOnce(res);
  }
  return fn;
}

describe("fetchPublicImage", () => {
  it.each([
    "http://example.com/a.png",
    "https://127.0.0.1/a.png",
    "https://2130706433/a.png",
    "https://[::1]/a.png",
    "https://localhost/a.png",
    "https://localhost./a.png",
    "https://localhost../a.png",
    "https://127.0.0.1../a.png",
    "https://foo.localhost.../a.png",
    "https://printer.local../a.png",
    "https://foo.localhost/a.png",
    "https://printer.local/a.png",
    "https://a.internal/a.png",
    "https://example.com:8443/a.png",
    "https://user:pass@example.com/a.png",
    "ftp://example.com/a.png",
    "not a url",
  ])("%s は url_not_allowed で、fetch を呼ばない", async (url) => {
    const fetcher = fetcherOf();
    const result = await fetchPublicImage(url, { userAgent: UA, fetcher: fetcher });
    expect(result).toMatchObject({ ok: false, code: "url_not_allowed" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("公開ホストから 169.254.169.254 へ 302 すると、2 回目の fetch をせず url_not_allowed(Review Focus 4)", async () => {
    const fetcher = fetcherOf(redirect("http://169.254.169.254/latest/meta-data/"));
    const result = await fetchPublicImage("https://example.com/a.png", {
      userAgent: UA,
      fetcher: fetcher,
    });
    expect(result).toMatchObject({ ok: false, code: "url_not_allowed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("https の IP リテラルへのリダイレクトも url_not_allowed", async () => {
    const fetcher = fetcherOf(redirect("https://10.0.0.1/a.png", 301));
    const result = await fetchPublicImage("https://example.com/a.png", {
      userAgent: UA,
      fetcher: fetcher,
    });
    expect(result).toMatchObject({ ok: false, code: "url_not_allowed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("相対の Location は現在の URL から解決し、3 回までは辿る", async () => {
    const fetcher = fetcherOf(
      redirect("/b"),
      redirect("https://cdn.example.com/c"),
      redirect("d.png"),
      png(),
    );
    const result = await fetchPublicImage("https://example.com/a.png", {
      userAgent: UA,
      fetcher: fetcher,
    });
    expect(result).toMatchObject({ ok: true, contentType: "image/png", filename: "d.png" });
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://example.com/a.png",
      "https://example.com/b",
      "https://cdn.example.com/c",
      "https://cdn.example.com/d.png",
    ]);
    for (const call of fetcher.mock.calls) {
      expect(call[1]).toMatchObject({ redirect: "manual" });
      // M5a-6: 各ホップに User-Agent を付ける(リダイレクト先でも)
      expect(new Headers(call[1]?.headers).get("user-agent")).toBe(UA);
    }
  });

  it(`${MAX_IMPORT_REDIRECTS + 1} 回目のリダイレクトは fetch_failed`, async () => {
    const fetcher = fetcherOf(redirect("/1"), redirect("/2"), redirect("/3"), redirect("/4"));
    const result = await fetchPublicImage("https://example.com/a.png", {
      userAgent: UA,
      fetcher: fetcher,
    });
    expect(result).toMatchObject({ ok: false, code: "fetch_failed" });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("2xx 以外と fetch の例外は fetch_failed", async () => {
    expect(
      await fetchPublicImage("https://example.com/a.png", {
        userAgent: UA,
        fetcher: fetcherOf(new Response("no", { status: 404 })),
      }),
    ).toMatchObject({ ok: false, code: "fetch_failed" });
    const throwing = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("timeout"));
    expect(
      await fetchPublicImage("https://example.com/a.png", { userAgent: UA, fetcher: throwing }),
    ).toMatchObject({
      ok: false,
      code: "fetch_failed",
    });
  });

  it("image/svg+xml と Content-Type 無しは unsupported_type", async () => {
    expect(
      await fetchPublicImage("https://example.com/a.svg", {
        userAgent: UA,
        fetcher: fetcherOf(png({ "content-type": "image/svg+xml" })),
      }),
    ).toMatchObject({ ok: false, code: "unsupported_type" });
    expect(
      await fetchPublicImage("https://example.com/a", {
        userAgent: UA,
        fetcher: fetcherOf(new Response(PNG, { status: 200 })),
      }),
    ).toMatchObject({ ok: false, code: "unsupported_type" });
  });

  it("Content-Length が上限を超えると too_large", async () => {
    const result = await fetchPublicImage("https://example.com/a.png", {
      userAgent: UA,
      fetcher: fetcherOf(png({ "content-length": String(MAX_ASSET_SIZE_BYTES + 1) })),
    });
    expect(result).toMatchObject({ ok: false, code: "too_large" });
  });

  it("Content-Length 無しで 20 MiB + 1 を流すと too_large", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_ASSET_SIZE_BYTES) {
          controller.close();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const result = await fetchPublicImage("https://example.com/a.png", {
      userAgent: UA,
      fetcher: fetcherOf(
        new Response(stream, { status: 200, headers: { "content-type": "image/png" } }),
      ),
    });
    expect(result).toMatchObject({ ok: false, code: "too_large" });
  });

  it("正常な PNG は ok。Content-Type の引数は落とし、ファイル名は最後のパス要素(無ければ image)", async () => {
    const ok = await fetchPublicImage("https://example.com/photos/%E6%98%A5.png?w=1", {
      userAgent: UA,
      fetcher: fetcherOf(png({ "content-type": "IMAGE/PNG; charset=binary" })),
    });
    expect(ok).toMatchObject({ ok: true, contentType: "image/png", filename: "春.png" });
    if (ok.ok) {
      expect(ok.body.byteLength).toBe(PNG.byteLength);
    }
    expect(
      await fetchPublicImage("https://example.com/", { userAgent: UA, fetcher: fetcherOf(png()) }),
    ).toMatchObject({
      ok: true,
      filename: "image",
    });
  });
});

describe("importUserAgent(M5a-6)", () => {
  it("API_ORIGIN があれば連絡先として添え、無ければ名前だけ", async () => {
    const { importUserAgent } = await import("../src/assets/fetch-url");
    expect(importUserAgent("https://api.example")).toBe(UA);
    expect(importUserAgent(undefined)).toBe("plyrs-asset-import/1");
  });
});
