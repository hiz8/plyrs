import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";
import { pendingConnect } from "./test-utils/fake-socket";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = Mock<(init?: RequestInit) => Response>;

function stubFetch(routes: Record<string, Handler>): typeof fetch {
  return async (input, init) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : new URL(input.url).pathname;
    const handler = routes[path];
    if (handler === undefined) {
      throw new Error(`unexpected fetch: ${path}`);
    }
    return handler(init ?? undefined);
  };
}

function renderAt(path: string, routes: Record<string, Handler>) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes), { connect: () => pendingConnect }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

const blogTenant = { id: "t1", slug: "blog", name: "Blog", role: "owner" };

const articleRow = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  fields: [
    { key: "title", type: "text", required: true },
    {
      key: "tags",
      type: "select",
      config: { options: [{ value: "tech", label: "Tech" }], multiple: true },
    },
  ],
  source: "user",
  pluginId: null,
  createdAt: "2026-07-16T00:00:00Z",
  updatedAt: "2026-07-16T00:00:00Z",
  version: 2,
};

function authedRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "/auth/tenants": vi.fn(() => jsonResponse(200, { tenants: [blogTenant] })),
    "/auth/token": vi.fn(() => jsonResponse(200, { token: "jwt-abc", expiresIn: 900 })),
    "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [articleRow] })),
    ...overrides,
  };
}

describe("content_type ビルダー", () => {
  it("links from the list to the builder pages", async () => {
    renderAt("/t/blog/content-types", authedRoutes());
    expect(await screen.findByRole("link", { name: "新規コンテンツタイプ" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "編集" })).toBeInTheDocument();
  });

  it("creates a new content type and PUTs the definition", async () => {
    const contentTypesHandler: Handler = vi.fn((init?: RequestInit) =>
      init?.method === "PUT"
        ? jsonResponse(200, { ok: true, contentType: { ...articleRow, key: "author", version: 1 } })
        : jsonResponse(200, { contentTypes: [articleRow] }),
    );
    renderAt(
      "/t/blog/content-types/new",
      authedRoutes({ "/v1/t/t1/content-types": contentTypesHandler }),
    );
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "key" }), "author");
    await user.type(screen.getByRole("textbox", { name: "表示名" }), "著者");
    await user.click(screen.getByRole("button", { name: "フィールドを追加" }));
    await user.type(screen.getByRole("textbox", { name: "フィールド key" }), "name");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await vi.waitFor(() => {
      const putCall = contentTypesHandler.mock.calls.find(
        (call) => (call[0] as RequestInit | undefined)?.method === "PUT",
      );
      if (putCall === undefined) {
        throw new Error("PUT request not observed yet");
      }
      const body = JSON.parse(String((putCall[0] as RequestInit).body)) as {
        key: string;
        name: string;
        source: string;
        version: number;
        fields: { key: string; type: string }[];
        id: string;
      };
      expect(body.key).toBe("author");
      expect(body.name).toBe("著者");
      expect(body.source).toBe("user");
      expect(body.version).toBe(1);
      expect(body.fields).toStrictEqual([{ key: "name", type: "text" }]);
      expect(body.id).toMatch(/^[0-9a-f]{8}-/);
    });
    // 保存後は一覧へ戻る
    expect(await screen.findByRole("heading", { name: "コンテンツタイプ" })).toBeInTheDocument();
  });

  it("prefills the edit form, disables the key, and shows the migration warning", async () => {
    renderAt("/t/blog/content-types/article/edit", authedRoutes());
    const keyInput = await screen.findByRole("textbox", { name: "key" });
    expect(keyInput).toHaveValue("article");
    expect(keyInput).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "表示名" })).toHaveValue("記事");
    // 既存フィールドの draft がプリフィルされる
    expect(screen.getByDisplayValue("title")).toBeInTheDocument();
    expect(screen.getByText(/既存のレコードは自動では追従しません/)).toBeInTheDocument();
  });

  it("sends the current version on edit so the server bumps it", async () => {
    const contentTypesHandler: Handler = vi.fn((init?: RequestInit) =>
      init?.method === "PUT"
        ? jsonResponse(200, { ok: true, contentType: { ...articleRow, version: 3 } })
        : jsonResponse(200, { contentTypes: [articleRow] }),
    );
    renderAt(
      "/t/blog/content-types/article/edit",
      authedRoutes({ "/v1/t/t1/content-types": contentTypesHandler }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "保存" }));
    await vi.waitFor(() => {
      const putCall = contentTypesHandler.mock.calls.find(
        (call) => (call[0] as RequestInit | undefined)?.method === "PUT",
      );
      if (putCall === undefined) {
        throw new Error("PUT request not observed yet");
      }
      const body = JSON.parse(String((putCall[0] as RequestInit).body)) as {
        id: string;
        version: number;
      };
      expect(body.id).toBe(articleRow.id);
      expect(body.version).toBe(2);
    });
  });

  it("shows server rejections in the banner", async () => {
    const contentTypesHandler: Handler = vi.fn((init?: RequestInit) =>
      init?.method === "PUT"
        ? jsonResponse(409, { ok: false, code: "id_mismatch", message: "key taken" })
        : jsonResponse(200, { contentTypes: [articleRow] }),
    );
    renderAt(
      "/t/blog/content-types/article/edit",
      authedRoutes({ "/v1/t/t1/content-types": contentTypesHandler }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/id_mismatch/);
  });
});
