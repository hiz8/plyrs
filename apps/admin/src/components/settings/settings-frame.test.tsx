import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
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

it("タブを選んで遷移した後、次に描かれた枠は選択中のタブにフォーカスを戻す", async () => {
  renderFrame({});
  await userEvent.setup().click(screen.getByRole("tab", { name: "一般" }));
  cleanup();
  render(
    <TenantSyncProvider sync={sync}>
      <SettingsFrame tab="general" slug="blog">
        <p>本文</p>
      </SettingsFrame>
    </TenantSyncProvider>,
  );
  // RAC のタブは collection 構築後に DOM へ出るため、フォーカスは少し遅れる
  await waitFor(() => expect(screen.getByRole("tab", { name: "一般" })).toHaveFocus());
});

it("タブを選ばずに描いた枠はフォーカスを動かさない", () => {
  renderFrame({});
  expect(screen.getByRole("tab", { name: "メンバー" })).not.toHaveFocus();
});

it("StrictMode(effect の二重実行)でも、選択中のタブへ一度だけフォーカスが移る", async () => {
  render(
    <StrictMode>
      <TenantSyncProvider sync={sync}>
        <SettingsFrame tab="members" slug="blog">
          <p>本文</p>
        </SettingsFrame>
      </TenantSyncProvider>
    </StrictMode>,
  );
  await userEvent.setup().click(screen.getByRole("tab", { name: "一般" }));
  cleanup();
  render(
    <StrictMode>
      <TenantSyncProvider sync={sync}>
        <SettingsFrame tab="general" slug="blog">
          <p>本文</p>
        </SettingsFrame>
      </TenantSyncProvider>
    </StrictMode>,
  );
  await waitFor(() => expect(screen.getByRole("tab", { name: "一般" })).toHaveFocus());
  expect(document.activeElement).toBe(document.querySelector('[role="tab"][aria-selected="true"]'));
  // 消費済み: 別の枠を描き直してもフォーカスを奪わない
  cleanup();
  render(
    <StrictMode>
      <TenantSyncProvider sync={sync}>
        <SettingsFrame tab="general" slug="blog">
          <p>本文</p>
        </SettingsFrame>
      </TenantSyncProvider>
    </StrictMode>,
  );
  expect(screen.getByRole("tab", { name: "一般" })).not.toHaveFocus();
});
