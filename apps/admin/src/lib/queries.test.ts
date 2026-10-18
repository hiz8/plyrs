import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api-client";
import { meQueryOptions } from "./queries";

describe("meQueryOptions", () => {
  it("keeps the signed-in user for the whole session without refetching", async () => {
    const queryClient = new QueryClient();
    const getMe = vi.fn(async () => ({ userId: "u1", email: "a@example.com" }));
    const api = { getMe } as unknown as ApiClient;
    await queryClient.fetchQuery(meQueryOptions(api));
    await queryClient.fetchQuery(meQueryOptions(api));
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(meQueryOptions(api).queryKey).toStrictEqual(["me"]);
  });
});
