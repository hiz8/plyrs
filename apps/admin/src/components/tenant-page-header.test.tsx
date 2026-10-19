import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SyncStatus } from "@plyrs/sync-client";
import { expect, it, vi } from "vitest";
import type { TenantSync } from "../lib/sync";
import { TenantSyncProvider } from "../lib/sync-context";
import { PageLoading, TenantPageHeader } from "./tenant-page-header";

function fakeSync(status: SyncStatus, hasSynced: boolean) {
  const start = vi.fn();
  // 文書化された境界 cast: テストに必要な面だけを持つ最小スタブ(エンジン実体は不要)
  const sync = {
    getStatus: () => status,
    getHasSynced: () => hasSynced,
    getTypes: () => [],
    subscribe: () => () => {},
    start,
    stop: vi.fn(),
    engine: {} as never,
    registry: {} as never,
  } as unknown as TenantSync;
  return { sync, start };
}

it("切断中はヘッダーの下に接続バナーを出し、今すぐ再接続で start() を呼ぶ", async () => {
  const { sync, start } = fakeSync("closed", true);
  render(
    <TenantSyncProvider sync={sync}>
      <TenantPageHeader title="お知らせ" />
    </TenantSyncProvider>,
  );
  const banner = screen.getByRole("status");
  expect(banner).toHaveTextContent("サーバーとの接続が切れています");
  expect(
    screen.getByRole("banner").compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "今すぐ再接続" }));
  expect(start).toHaveBeenCalledTimes(1);
});

it("同期済みならバナーを出さない", () => {
  render(
    <TenantSyncProvider sync={fakeSync("ready", true).sync}>
      <TenantPageHeader title="お知らせ" />
    </TenantSyncProvider>,
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("初回同期の前はスケルトンの見出しと読み込み中の本文を出す", () => {
  render(
    <TenantSyncProvider sync={fakeSync("connecting", false).sync}>
      <PageLoading breadcrumbs={[{ id: "home", label: "ホーム", href: "/t/blog" }]} />
    </TenantSyncProvider>,
  );
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("読み込み中");
  expect(screen.getByRole("status", { name: "読み込み中" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "ホーム" })).toHaveAttribute("href", "/t/blog");
});
