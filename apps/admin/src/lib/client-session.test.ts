import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api-client";
import { resetClientSession } from "./client-session";
import { meQueryOptions, tenantsQueryOptions } from "./queries";
import { createTokenManager } from "./token-manager";

function apiFor(userId: string): ApiClient {
  return {
    getMe: vi.fn(async () => ({ userId, email: `${userId}@example.com` })),
    listTenants: vi.fn(async () => []),
  } as unknown as ApiClient;
}

describe("resetClientSession", () => {
  it("drops the previous user's tenant JWTs and query cache before the next session", async () => {
    // セッション失効で /login に戻され、同じタブで別の利用者がログインし直した場面
    const queryClient = new QueryClient();
    const issueToken = vi
      .fn()
      .mockResolvedValueOnce({ token: "jwt-of-a", expiresIn: 900 })
      .mockResolvedValueOnce({ token: "jwt-of-b", expiresIn: 900 });
    const tokens = createTokenManager({ issueToken, now: () => 0 });
    const before = apiFor("a");
    await queryClient.fetchQuery(meQueryOptions(before));
    await queryClient.fetchQuery(tenantsQueryOptions(before));
    expect(await tokens.getToken("tenant-x")).toBe("jwt-of-a");

    resetClientSession({ queryClient, tokens });

    expect(queryClient.getQueryData(["me"])).toBeUndefined();
    expect(queryClient.getQueryData(["tenants"])).toBeUndefined();
    // 有効期限内でも前の利用者の JWT は使い回さず、新しいセッションで発行し直す
    expect(await tokens.getToken("tenant-x")).toBe("jwt-of-b");
    expect(issueToken).toHaveBeenCalledTimes(2);
    expect(await queryClient.fetchQuery(meQueryOptions(apiFor("b")))).toStrictEqual({
      userId: "b",
      email: "b@example.com",
    });
  });
});
