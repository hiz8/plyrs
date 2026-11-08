import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SiteList } from "./site-list";

it("現在のサイトは「現在のサイト」、他は「切り替える」のリンク", () => {
  render(
    <SiteList
      currentId="t1"
      tenants={[
        { id: "t1", slug: "blog", name: "Blog", role: "owner" },
        { id: "t2", slug: "shop", name: "Shop", role: "viewer" },
      ]}
    />,
  );
  expect(screen.getByText("現在のサイト")).toBeInTheDocument();
  const links = screen.getAllByRole("link", { name: "切り替える" });
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute("href", "/t/shop");
  expect(screen.getByText("Blog")).toBeInTheDocument();
  expect(screen.getByText("Shop")).toBeInTheDocument();
});
