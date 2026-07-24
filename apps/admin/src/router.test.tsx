import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createAppContext, getRouter } from "./router";
import { startInstance } from "./start";

function stubFetch(status: number, body: unknown): typeof fetch {
  return async (input) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : new URL(input.url).pathname;
    // login の loader が無条件で叩く。この経路の関心事ではないので常に無効(siteKey: null)を返す。
    if (path === "/auth/turnstile-config") {
      return new Response(JSON.stringify({ siteKey: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
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

  it("has defaultSsr set to false via the start instance", async () => {
    const options = await startInstance.getOptions();
    expect(options.defaultSsr).toBe(false);
  });
});
