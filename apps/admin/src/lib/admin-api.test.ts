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
});
