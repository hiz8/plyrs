import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api-client";
import { meQueryOptions, startSession, tenantsQueryOptions } from "./queries";

function apiReturning(me: { userId: string; email: string }): ApiClient {
  return {
    getMe: vi.fn(async () => me),
    listTenants: vi.fn(async () => []),
  } as unknown as ApiClient;
}

describe("meQueryOptions / startSession", () => {
  it("keeps the signed-in user for the whole session without refetching", async () => {
    const queryClient = new QueryClient();
    const api = apiReturning({ userId: "u1", email: "a@example.com" });
    await queryClient.fetchQuery(meQueryOptions(api));
    await queryClient.fetchQuery(meQueryOptions(api));
    expect(api.getMe).toHaveBeenCalledTimes(1);
    expect(meQueryOptions(api).queryKey).toStrictEqual(["me"]);
  });

  it("drops the previous user's cache when a new session starts", async () => {
    const queryClient = new QueryClient();
    const before = apiReturning({ userId: "u1", email: "a@example.com" });
    await queryClient.fetchQuery(meQueryOptions(before));
    await queryClient.fetchQuery(tenantsQueryOptions(before));

    // セッション失効で /login に戻され、別の利用者がログインし直した場面
    startSession(queryClient);
    expect(queryClient.getQueryData(["me"])).toBeUndefined();
    expect(queryClient.getQueryData(["tenants"])).toBeUndefined();

    const after = apiReturning({ userId: "u2", email: "b@example.com" });
    expect(await queryClient.fetchQuery(meQueryOptions(after))).toStrictEqual({
      userId: "u2",
      email: "b@example.com",
    });
  });
});
