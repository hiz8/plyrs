import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { TenantSync } from "../../lib/sync";
import { TenantSyncProvider } from "../../lib/sync-context";
import { SettingsFrame } from "./settings-frame";

// SettingsFrame は useNavigate を使うため、router 無しで描けるよう差し替える
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

// 文書化された境界 cast: テストに必要な面だけを持つ最小スタブ
const sync = {
  getStatus: () => "ready",
  getHasSynced: () => true,
  getTypes: () => [],
  subscribe: () => () => {},
  start: vi.fn(),
  stop: vi.fn(),
} as unknown as TenantSync;

function renderFrame(props: {
  isLoading?: boolean;
  error?: { message: string; onRetry: () => void };
}) {
  return render(
    <TenantSyncProvider sync={sync}>
      <SettingsFrame tab="members" slug="blog" {...props}>
        <p>本文</p>
      </SettingsFrame>
    </TenantSyncProvider>,
  );
}

it("読み込み中は入れ物に aria-busy が付き、h1 とタブは最初から出て本文は出ない", () => {
  renderFrame({ isLoading: true });
  expect(screen.getByRole("heading", { level: 1, name: "設定" })).toBeInTheDocument();
  expect(screen.getAllByRole("tab")).toHaveLength(4);
  expect(screen.queryByText("本文")).not.toBeInTheDocument();
  expect(screen.getByRole("tabpanel").firstElementChild).toHaveAttribute("aria-busy", "true");
});

it("error があれば本文の代わりに alert と再試行を出す", () => {
  renderFrame({ error: { message: "失敗しました", onRetry: vi.fn() } });
  expect(screen.getByRole("alert")).toHaveTextContent("失敗しました");
  expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  expect(screen.queryByText("本文")).not.toBeInTheDocument();
});
