import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import { createAdminApi } from "./admin-api";
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
