import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getRouter } from "./router";

describe("router scaffold", () => {
  it("renders the index route at /", async () => {
    const router = getRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("plyrs admin")).toBeInTheDocument();
  });
});
