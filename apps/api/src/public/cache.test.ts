import { describe, expect, it } from "vitest";
import { canonicalCacheUrl, PUBLIC_CACHE_TTL_SECONDS, withEdgeCache } from "./cache";

// ExecutionContext の無い環境（app.request 直呼び相当）を偽装する
function fakeContext(headers: Record<string, string> = {}) {
  return {
    req: { raw: new Request("https://example.com/x", { headers }) },
    get executionCtx(): ExecutionContext {
      throw new Error("no execution context");
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("canonicalCacheUrl", () => {
  it("sorts keys and values so param order cannot split the cache", () => {
    const a = canonicalCacheUrl("t1", "records/post", {
      sort: ["-published_at"],
      "filter[tags]": ["y", "x"],
      limit: ["5"],
    });
    const b = canonicalCacheUrl("t1", "records/post", {
      limit: ["5"],
      "filter[tags]": ["x", "y"],
      sort: ["-published_at"],
    });
    expect(a).toBe(b);
  });

  it("keys by resolved tenant id, not by slug", () => {
    const a = canonicalCacheUrl("t1", "records/post", {});
    const b = canonicalCacheUrl("t2", "records/post", {});
    expect(a).not.toBe(b);
  });
});

describe("withEdgeCache (裁定 2026-07-14: Cache API + 短 TTL・パージなし)", () => {
  it("serves the second call from cache without invoking produce", async () => {
    const url = canonicalCacheUrl(crypto.randomUUID(), "records/post/id/r1", {});
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return jsonResponse({ n: calls });
    };
    const first = await withEdgeCache(fakeContext(), url, produce);
    expect(await first.json()).toStrictEqual({ n: 1 });
    expect(first.headers.get("cache-control")).toBe(
      `public, max-age=0, s-maxage=${PUBLIC_CACHE_TTL_SECONDS}`,
    );
    const second = await withEdgeCache(fakeContext(), url, produce);
    expect(await second.json()).toStrictEqual({ n: 1 });
    expect(calls).toBe(1);
  });

  it("does not cache non-200 responses", async () => {
    const url = canonicalCacheUrl(crypto.randomUUID(), "records/post/id/missing", {});
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return jsonResponse({ error: "not_found" }, 404);
    };
    expect((await withEdgeCache(fakeContext(), url, produce)).status).toBe(404);
    await withEdgeCache(fakeContext(), url, produce);
    expect(calls).toBe(2);
  });

  it("answers 304 when If-None-Match matches the response etag", async () => {
    const url = canonicalCacheUrl(crypto.randomUUID(), "records/post/id/r2", {});
    const produce = async () => {
      const response = jsonResponse({ v: 1 });
      response.headers.set("etag", 'W/"7"');
      return response;
    };
    const first = await withEdgeCache(fakeContext(), url, produce);
    expect(first.status).toBe(200);
    const revalidated = await withEdgeCache(fakeContext({ "if-none-match": 'W/"7"' }), url, produce);
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");
  });

  it("does not turn a non-200 response into a 304 even when the etag matches", async () => {
    // 非 200 は 304 に化けてはならない: 304 は「キャッシュ可能な表現が変わっていない」ことの
    // 表明であり、404 等のエラーに etag が付いていてもエラーのステータスをそのまま返すべき。
    const url = canonicalCacheUrl(crypto.randomUUID(), "records/post/id/gone", {});
    const produce = async () => {
      const response = jsonResponse({ error: "not_found" }, 404);
      response.headers.set("etag", 'W/"9"');
      return response;
    };
    const result = await withEdgeCache(fakeContext({ "if-none-match": 'W/"9"' }), url, produce);
    expect(result.status).toBe(404);
  });
});
