import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ModuleSummary } from "../../lib/admin-api";
import { ModuleCard } from "./module-card";

const booking: ModuleSummary = {
  moduleId: "booking",
  name: "予約",
  description: "予約枠を公開し、予約を受け付けます。",
  navTypes: ["booking.slot"],
  version: 2,
  enabled: true,
  appliedVersion: 2,
};

const addLinks = [
  { key: "booking.slot", label: "予約枠を追加", href: "/t/blog/content/booking.slot/new" },
];

describe("ModuleCard", () => {
  it("名前・有効のバッジ・説明・ボタンを出し、justEnabled なら帯と追加のリンクが出る", async () => {
    const onDisable = vi.fn();
    render(
      <ModuleCard
        module={booking}
        addLinks={addLinks}
        justEnabled
        onEnable={vi.fn()}
        onDisable={onDisable}
      />,
    );
    const card = screen.getByRole("region", { name: /予約/ });
    expect(within(card).getByRole("heading", { level: 2 })).toHaveTextContent("予約");
    expect(within(card).getByText("有効")).toBeVisible();
    expect(within(card).getByText(booking.description ?? "")).toBeVisible();
    expect(within(card).getByRole("status")).toHaveTextContent("有効にしました。");
    expect(within(card).getByRole("link", { name: /予約枠を追加/ })).toHaveAttribute(
      "href",
      "/t/blog/content/booking.slot/new",
    );
    expect(card).not.toHaveTextContent("booking");
    expect(card).not.toHaveTextContent("v2");
    await userEvent.click(within(card).getByRole("button", { name: "無効にする" }));
    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  it("無効なモジュールは「有効にする」で onEnable を呼び、帯は出さない", async () => {
    const onEnable = vi.fn();
    render(
      <ModuleCard
        module={{ ...booking, enabled: false, description: null }}
        addLinks={addLinks}
        justEnabled={false}
        onEnable={onEnable}
        onDisable={vi.fn()}
      />,
    );
    expect(screen.getByText("無効")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "有効にする" }));
    expect(onEnable).toHaveBeenCalledTimes(1);
  });
});
