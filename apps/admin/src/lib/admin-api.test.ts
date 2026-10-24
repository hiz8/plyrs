import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import { createFakeXhr } from "../test-utils/fake-xhr";
import { createAdminApi, type UploadProgress } from "./admin-api";
import { createTokenManager } from "./token-manager";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function manager(token = "jwt-1") {
  return createTokenManager({
    issueToken: vi.fn().mockResolvedValue({ token, expiresIn: 900 }),
    now: () => 0,
  });
}

const fetchBinaryStub: typeof fetch = async () =>
  new Response(Uint8Array.from([9, 9]), { status: 200 });

// パスごとにハンドラを引くだけの最小 fetch スタブ。呼び出し検証は各ハンドラの vi.fn() 側で行う。
function stubFetch(routes: Record<string, (init?: RequestInit) => Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const handler = routes[url];
    if (handler === undefined) {
      throw new Error(`stubFetch: no handler registered for ${url}`);
    }
    return handler(init);
  }) as typeof fetch;
}

describe("admin api (Bearer 付き /v1/t/:tenantId)", () => {
  it("lists content types with a Bearer token from the manager", async () => {
    const contentTypes = [
      {
        id: "c1",
        key: "article",
        name: "記事",
        fields: [],
        source: "user",
        pluginId: null,
        createdAt: "",
        updatedAt: "",
        version: 1,
        description: null,
        titleField: null,
        listColumns: null,
        menuOrder: null,
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { contentTypes }));
    const adminApi = createAdminApi(manager(), fetchImpl);
    expect(await adminApi.listContentTypes("tenant-1")).toStrictEqual(contentTypes);
    const [path, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/v1/t/tenant-1/content-types");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer jwt-1");
  });

  it("throws ApiError on gate rejection", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "wrong_tenant" }));
    const adminApi = createAdminApi(manager(), fetchImpl);
    const error = await adminApi.listContentTypes("tenant-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("wrong_tenant");
  });

  it("puts a content type definition and returns the stored row", async () => {
    // 明示的な RequestInit 引数を付けて mock.calls[0][0] を型付きで拾えるようにする
    const handler = vi.fn((_init?: RequestInit) =>
      jsonResponse(200, { ok: true, contentType: { id: "c1", key: "article", version: 2 } }),
    );
    const adminApi = createAdminApi(manager(), stubFetch({ "/v1/t/t1/content-types": handler }));
    const definition: ContentTypeDefinition = {
      id: "c1",
      key: "article",
      name: "記事",
      fields: [],
      source: "user",
      version: 1,
    };
    const row = await adminApi.putContentType("t1", definition);
    expect(row).toMatchObject({ key: "article", version: 2 });
    const init = handler.mock.calls[0]?.[0] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toMatchObject({ key: "article" });
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer jwt-1");
  });

  it("lists publications for a type, or for all types when omitted", async () => {
    const publications = [
      { recordId: "r1", publishedAt: "2026-10-17T00:00:00Z", sourceVersion: 2 },
    ];
    const handler = vi.fn(() => jsonResponse(200, { publications, nextCursor: null }));
    const adminApi = createAdminApi(
      manager(),
      stubFetch({
        "/v1/t/t1/publications?type=news%2Fx": handler,
        "/v1/t/t1/publications": handler,
      }),
    );
    expect(await adminApi.listPublications("t1", "news/x")).toStrictEqual(publications);
    expect(await adminApi.listPublications("t1")).toStrictEqual(publications);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("follows nextCursor until the last page and concatenates them", async () => {
    const first = { recordId: "r1", publishedAt: "2026-10-17T00:00:00Z", sourceVersion: 1 };
    const second = { recordId: "r2", publishedAt: "2026-10-17T00:00:01Z", sourceVersion: 3 };
    const adminApi = createAdminApi(
      manager(),
      stubFetch({
        "/v1/t/t1/publications?type=article": () =>
          jsonResponse(200, { publications: [first], nextCursor: "r1" }),
        "/v1/t/t1/publications?type=article&cursor=r1": () =>
          jsonResponse(200, { publications: [second], nextCursor: null }),
      }),
    );
    expect(await adminApi.listPublications("t1", "article")).toStrictEqual([first, second]);
  });

  it("publishes, unpublishes and reads publication state", async () => {
    // 同上: mock.calls[0][0] を型付きで拾うため引数を明示する
    const publish = vi.fn((_init?: RequestInit) => jsonResponse(200, { ok: true }));
    const unpublish = vi.fn((_init?: RequestInit) => jsonResponse(200, { ok: true }));
    const publication = vi.fn(() =>
      jsonResponse(200, {
        published: true,
        publishedAt: "2026-07-17T00:00:00Z",
        publishedBy: "u1",
        sourceVersion: 3,
      }),
    );
    const adminApi = createAdminApi(
      manager(),
      stubFetch({
        "/v1/t/t1/records/r1/publish": publish,
        "/v1/t/t1/records/r1/unpublish": unpublish,
        "/v1/t/t1/records/r1/publication": publication,
      }),
    );
    await adminApi.publishRecord("t1", "r1");
    await adminApi.unpublishRecord("t1", "r1");
    const state = await adminApi.getPublication("t1", "r1");
    const publishInit = publish.mock.calls[0]?.[0] as RequestInit;
    const unpublishInit = unpublish.mock.calls[0]?.[0] as RequestInit;
    expect(publishInit.method).toBe("POST");
    expect(unpublishInit.method).toBe("POST");
    expect(state).toMatchObject({ published: true, sourceVersion: 3 });
  });

  it("retries once with forceRefresh when the api answers 401", async () => {
    const issued: string[] = [];
    const tokens = createTokenManager({
      issueToken: async () => {
        const token = `jwt-${issued.length + 1}`;
        issued.push(token);
        return { token, expiresIn: 900 };
      },
    });
    const handler = vi.fn((init?: RequestInit) => {
      const bearer = new Headers(init?.headers).get("authorization");
      return bearer === "Bearer jwt-2"
        ? jsonResponse(200, { contentTypes: [] })
        : jsonResponse(401, { error: "token_expired" });
    });
    const adminApi = createAdminApi(tokens, stubFetch({ "/v1/t/t1/content-types": handler }));
    await expect(adminApi.listContentTypes("t1")).resolves.toStrictEqual([]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("carries the server error code and message on failures", async () => {
    const adminApi = createAdminApi(
      manager(),
      stubFetch({
        "/v1/t/t1/content-types": vi.fn(() =>
          jsonResponse(409, { ok: false, code: "id_mismatch", message: "key taken" }),
        ),
      }),
    );
    const definition: ContentTypeDefinition = {
      id: "c1",
      key: "a",
      name: "A",
      fields: [],
      source: "user",
      version: 1,
    };
    // 401 リトライは 1 回だけなので 409 はそのまま ApiError になる
    const error = await adminApi.putContentType("t1", definition).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("id_mismatch");
    expect((error as ApiError).detail).toBe("key taken");
  });
});

describe("deleteContentType (案 E 5.4)", () => {
  it("sends DELETE and surfaces type_not_empty as ApiError", async () => {
    const calls: { url: string; method: string | undefined }[] = [];
    let status = 200;
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), method: init?.method });
      return status === 200
        ? jsonResponse(200, { ok: true, key: "booking.slot" })
        : jsonResponse(409, { ok: false, code: "type_not_empty", message: "has records" });
    };
    const adminApi = createAdminApi(manager(), fetchImpl);
    await adminApi.deleteContentType("t1", "booking.slot");
    expect(calls[0]).toStrictEqual({
      url: "/v1/t/t1/content-types/booking.slot",
      method: "DELETE",
    });
    status = 409;
    const error = await adminApi.deleteContentType("t1", "article").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("type_not_empty");
  });
});

describe("asset endpoints (Phase 8)", () => {
  it("uploadAsset は XHR で送り、進捗を onProgress に流す", async () => {
    const handler = vi.fn((_init?: RequestInit) =>
      jsonResponse(201, { ok: true, record: { id: "asset-1" } }),
    );
    const api = createAdminApi(manager(), vi.fn<typeof fetch>(), {
      createXhr: createFakeXhr({ "/v1/t/t1/assets": handler }),
    });
    const file = new File([Uint8Array.from([1, 2, 3, 4])], "hero 1.png", { type: "image/png" });
    const progress: UploadProgress[] = [];
    const result = await api.uploadAsset("t1", file, { onProgress: (p) => progress.push(p) });
    expect(result).toEqual({ id: "asset-1" });
    expect(progress).toEqual([
      { loaded: 2, total: 4 },
      { loaded: 4, total: 4 },
    ]);
    const init = handler.mock.calls[0]?.[0];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(file);
    expect(init?.headers).toEqual({ authorization: "Bearer jwt-1", "content-type": "image/png" });
  });

  it("uploadAsset は 401 で 1 回だけ再発行して新しい XHR で送り直す", async () => {
    const issueToken = vi
      .fn()
      .mockResolvedValueOnce({ token: "old", expiresIn: 900 })
      .mockResolvedValue({ token: "new", expiresIn: 900 });
    const tokens = createTokenManager({ issueToken, now: () => 0 });
    const handler = vi
      .fn<(init?: RequestInit) => Response>()
      .mockReturnValueOnce(jsonResponse(401, { error: "unauthorized" }))
      .mockReturnValue(jsonResponse(201, { ok: true, record: { id: "asset-1" } }));
    const routes = { "/v1/t/t1/assets": handler };
    const createXhr = vi.fn(createFakeXhr(routes));
    const api = createAdminApi(tokens, vi.fn<typeof fetch>(), { createXhr });
    const file = new File([Uint8Array.from([1, 2])], "a.png", { type: "image/png" });

    expect(await api.uploadAsset("t1", file)).toEqual({ id: "asset-1" });
    expect(createXhr).toHaveBeenCalledTimes(2);
    expect(issueToken).toHaveBeenCalledTimes(2);
    const sent = handler.mock.calls.map((call) => call[0]?.headers);
    expect(sent).toEqual([
      expect.objectContaining({ authorization: "Bearer old" }),
      expect.objectContaining({ authorization: "Bearer new" }),
    ]);
  });

  it("uploadAsset は signal の中止で XHR を止め、AbortError で終わる", async () => {
    const file = new File([Uint8Array.from([1, 2])], "a.png", { type: "image/png" });
    // 応答が返らないあいだに signal が中止される
    const pending = vi.fn(() => new Promise<Response>(() => {}));
    const abortApi = createAdminApi(manager(), vi.fn<typeof fetch>(), {
      createXhr: createFakeXhr({ "/v1/t/t1/assets": pending }),
    });
    const controller = new AbortController();
    const upload = abortApi.uploadAsset("t1", file, { signal: controller.signal });
    await vi.waitFor(() => expect(pending).toHaveBeenCalled());
    controller.abort();
    await expect(upload).rejects.toMatchObject({ name: "AbortError" });
  });

  it("uploadAsset は 413 を ApiError(too_large) にする", async () => {
    const api = createAdminApi(manager(), vi.fn<typeof fetch>(), {
      createXhr: createFakeXhr({
        "/v1/t/t1/assets": vi.fn(() => jsonResponse(413, { error: "too_large" })),
      }),
    });
    const file = new File([Uint8Array.from([1])], "big.png", { type: "image/png" });
    const error = await api.uploadAsset("t1", file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 413, code: "too_large" });
  });

  it("fetchAssetBlob returns the binary body", async () => {
    const api = createAdminApi(manager(), fetchBinaryStub);
    const blob = await api.fetchAssetBlob("t1", "asset-1");
    expect(blob.size).toBe(2);
  });

  it("listOrphanAssetIds / getAssetUsage / deleteRecord hit the expected paths", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      urls.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input).endsWith("/orphans")) {
        return jsonResponse(200, { orphanIds: ["a1"] });
      }
      if (String(input).endsWith("/usage")) {
        return jsonResponse(200, {
          usage: [{ sourceId: "r1", sourceType: "article", sourceField: "hero", origin: "field" }],
        });
      }
      return jsonResponse(200, { ok: true });
    };
    const api = createAdminApi(manager(), fetchImpl);
    expect(await api.listOrphanAssetIds("t1")).toEqual(["a1"]);
    expect(await api.getAssetUsage("t1", "a1")).toEqual([
      { sourceId: "r1", sourceType: "article", sourceField: "hero", origin: "field" },
    ]);
    await api.deleteRecord("t1", "r1");
    expect(urls).toEqual([
      "GET /v1/t/t1/assets/orphans",
      "GET /v1/t/t1/assets/a1/usage",
      "DELETE /v1/t/t1/records/r1",
    ]);
  });
});

describe("site settings endpoints (案 G 3・4 章)", () => {
  it("renames the site and manages members on the expected paths", async () => {
    const calls: string[] = [];
    const member = { userId: "u2", email: "e@x.com", role: "editor", createdAt: "" };
    const fetchImpl: typeof fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      calls.push(
        `${method} ${String(input)} ${typeof init?.body === "string" ? init.body : ""}`.trim(),
      );
      if (String(input).endsWith("/site")) {
        return jsonResponse(200, { ok: true, name: "新しい名前" });
      }
      if (method === "GET") {
        return jsonResponse(200, { members: [member] });
      }
      if (method === "DELETE") {
        return jsonResponse(200, { ok: true, disconnected: 0 });
      }
      return jsonResponse(method === "POST" ? 201 : 200, { member });
    };
    const api = createAdminApi(manager(), fetchImpl);
    expect(await api.renameSite("t1", "新しい名前")).toBe("新しい名前");
    expect(await api.listMembers("t1")).toStrictEqual([member]);
    expect(await api.addMember("t1", "e@x.com", "editor")).toStrictEqual(member);
    expect(await api.changeMemberRole("t1", "u2", "editor")).toStrictEqual(member);
    await api.removeMember("t1", "u2");
    expect(calls).toStrictEqual([
      'PATCH /v1/t/t1/site {"name":"新しい名前"}',
      "GET /v1/t/t1/members",
      'POST /v1/t/t1/members {"email":"e@x.com","role":"editor"}',
      'PATCH /v1/t/t1/members/u2 {"role":"editor"}',
      "DELETE /v1/t/t1/members/u2",
    ]);
  });

  it("surfaces the last-owner rejection as an ApiError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: "last_owner" }));
    const api = createAdminApi(manager(), fetchImpl);
    const error = await api.removeMember("t1", "u1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("last_owner");
  });
});
