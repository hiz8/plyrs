import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { AdminApi } from "./admin-api";
import type { ApiClient } from "./api-client";
import {
  meQueryOptions,
  openProposalCountQueryOptions,
  openProposalsQueryOptions,
} from "./queries";

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

function apiWith(listProposals: AdminApi["listProposals"]): AdminApi {
  return { listProposals } as unknown as AdminApi;
}

// 所有者レビュー 7・8(M5c): 件数だけが要る場面は 1 件だけ取る軽い問い合わせで、record ごとの件数は
// サーバーの絞り込み(openCount)で数える。先頭 100 件のクライアント絞り込みはしない
describe("openProposalCountQueryOptions", () => {
  it("テナント全体の件数は limit 1 で取り、30 秒ごとに取り直す", async () => {
    const listProposals = vi.fn().mockResolvedValue({ items: [], nextCursor: null, openCount: 3 });
    const options = openProposalCountQueryOptions(apiWith(listProposals), "tenant-1");
    expect(options.queryKey).toEqual(["proposals", "tenant-1", "open-count", null]);
    expect(options.refetchInterval).toBe(30_000);
    await (options.queryFn as () => Promise<unknown>)();
    expect(listProposals).toHaveBeenCalledWith("tenant-1", { state: "open", limit: 1 });
  });

  it("record ごとの件数はサーバーで recordId に絞り、取り直しの間隔は持たない", async () => {
    const listProposals = vi.fn().mockResolvedValue({ items: [], nextCursor: null, openCount: 1 });
    const options = openProposalCountQueryOptions(apiWith(listProposals), "tenant-1", "rec-1");
    expect(options.queryKey).toEqual(["proposals", "tenant-1", "open-count", "rec-1"]);
    expect(options.refetchInterval).toBeUndefined();
    await (options.queryFn as () => Promise<unknown>)();
    expect(listProposals).toHaveBeenCalledWith("tenant-1", {
      state: "open",
      recordId: "rec-1",
      limit: 1,
    });
  });
});

describe("openProposalsQueryOptions", () => {
  it("一覧の先頭ページは recordId をサーバーに渡し、取り直しの間隔は持たない", async () => {
    const listProposals = vi.fn().mockResolvedValue({ items: [], nextCursor: null, openCount: 0 });
    const options = openProposalsQueryOptions(apiWith(listProposals), "tenant-1", "rec-1");
    expect(options.queryKey).toEqual(["proposals", "tenant-1", "open", "rec-1"]);
    expect(options.refetchInterval).toBeUndefined();
    await (options.queryFn as () => Promise<unknown>)();
    expect(listProposals).toHaveBeenCalledWith("tenant-1", { state: "open", recordId: "rec-1" });
  });
});
