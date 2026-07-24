import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createAppContext, getRouter } from "./router";

function stubFetch(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

describe("router scaffold", () => {
  it("redirects / to /tenants (then /login when unauthenticated)", async () => {
    const router = getRouter({
      context: createAppContext(stubFetch(401, { error: "unauthenticated" })),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
  });

  it("has defaultSsr set to false", () => {
    const router = getRouter();
    expect(router.options.defaultSsr).toBe(false);
  });
});
