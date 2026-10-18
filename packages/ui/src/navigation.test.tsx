import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Breadcrumbs } from "./breadcrumbs";
import { Tabs } from "./tabs";

describe("Breadcrumbs", () => {
  it("nav の中に並べ、末尾を現在地にする", () => {
    render(
      <Breadcrumbs
        items={[
          { id: "home", label: "ホーム", href: "/t/acme" },
          { id: "news", label: "お知らせ", href: "/t/acme/content/news" },
          { id: "edit", label: "編集" },
        ]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "パンくず" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ホーム" })).toHaveAttribute("href", "/t/acme");
    expect(screen.getByText("編集").closest("[aria-current='page']")).not.toBeNull();
  });
});

describe("Tabs", () => {
  const items = [
    { id: "all", label: "すべて", count: 24 },
    { id: "published", label: "公開中", count: 15 },
    { id: "archived", label: "アーカイブ", count: 0 },
  ];

  it("件数を添え、選ぶと onSelectionChange に id を渡す", async () => {
    const onSelectionChange = vi.fn();
    render(
      <Tabs label="公開状態" items={items} selectedKey="all" onSelectionChange={onSelectionChange}>
        {(id) => <p>panel:{id}</p>}
      </Tabs>,
    );
    expect(screen.getByRole("tablist", { name: "公開状態" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /すべて/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /すべて/ })).toHaveTextContent("24");
    expect(screen.getByText("panel:all")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /公開中/ }));
    expect(onSelectionChange).toHaveBeenCalledWith("published");
  });

  it("件数 0 のタブ全体は薄くせず、件数のバッジだけで示す", () => {
    render(
      <Tabs label="公開状態" items={items} selectedKey="all" onSelectionChange={() => {}}>
        {(id) => <p>panel:{id}</p>}
      </Tabs>,
    );
    const nonZero = screen.getByRole("tab", { name: /公開中/ });
    const zero = screen.getByRole("tab", { name: /アーカイブ/ });
    expect(zero.className).toBe(nonZero.className);
    expect(screen.getByText("0").className).not.toBe(screen.getByText("15").className);
  });
});
