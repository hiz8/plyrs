import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./api-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api client (same-origin 相対パス・fetch 注入)", () => {
  it("posts credentials to /auth/login", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { userId: "u1" }));
    const api = createApiClient(fetchImpl);
    const result = await api.login("a@example.com", "hunter2hunter2");
    expect(result).toStrictEqual({ userId: "u1" });
    const [path, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/auth/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toStrictEqual({
      email: "a@example.com",
      password: "hunter2hunter2",
    });
  });

  it("unwraps the tenants list from GET /auth/tenants", async () => {
    const tenants = [{ id: "t1", slug: "blog", name: "Blog", role: "owner" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { tenants }));
    const api = createApiClient(fetchImpl);
    expect(await api.listTenants()).toStrictEqual(tenants);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/auth/tenants");
  });

  it("throws ApiError carrying the server error code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthenticated" }));
    const api = createApiClient(fetchImpl);
    const error = await api.listTenants().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).code).toBe("unauthenticated");
  });

  it("falls back to unknown_error for non-JSON error bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("Bad Gateway", { status: 502 }));
    const api = createApiClient(fetchImpl);
    const error = await api.logout().catch((e: unknown) => e);
    expect((error as ApiError).code).toBe("unknown_error");
  });
});
