import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createBrowserHistory,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useLeaveGuard } from "./use-leave-guard";

function Editor({ dirty }: { dirty: boolean }) {
  const blocker = useLeaveGuard(dirty);
  return (
    <div>
      <h1>編集画面</h1>
      {blocker.status === "blocked" && (
        <div role="dialog">
          <button type="button" onClick={() => blocker.proceed?.()}>
            移動する
          </button>
          <button type="button" onClick={() => blocker.reset?.()}>
            編集を続ける
          </button>
        </div>
      )}
    </div>
  );
}

function renderEditor(dirty: boolean, history = createMemoryHistory({ initialEntries: ["/"] })) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const editRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <Editor dirty={dirty} />,
  });
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/other",
    component: () => <h1>ほかの画面</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([editRoute, otherRoute]),
    history,
  });
  render(<RouterProvider router={router} />);
  return router;
}

type TestRouter = ReturnType<typeof renderEditor>;

// 履歴の push も useBlocker の対象になる(Link・navigate と同じ経路で止まる)
function goToOther(router: TestRouter) {
  act(() => {
    router.history.push("/other");
  });
}

describe("useLeaveGuard (案 C 7 章)", () => {
  it("lets navigation through when there are no unsaved edits", async () => {
    const router = renderEditor(false);
    await screen.findByRole("heading", { name: "編集画面" });
    goToOther(router);
    expect(await screen.findByRole("heading", { name: "ほかの画面" })).toBeInTheDocument();
  });

  it("blocks in-app navigation with unsaved edits until the user confirms", async () => {
    const router = renderEditor(true);
    await screen.findByRole("heading", { name: "編集画面" });
    goToOther(router);
    await userEvent.click(await screen.findByRole("button", { name: "編集を続ける" }));
    expect(router.state.location.pathname).toBe("/");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    goToOther(router);
    await userEvent.click(await screen.findByRole("button", { name: "移動する" }));
    expect(await screen.findByRole("heading", { name: "ほかの画面" })).toBeInTheDocument();
  });

  it("asks the browser to confirm closing or reloading the tab only while dirty", async () => {
    // beforeunload の確認はブラウザの履歴(createBrowserHistory)でだけ登録される
    renderEditor(true, createBrowserHistory());
    await screen.findByRole("heading", { name: "編集画面" });
    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
  });

  it("does not ask the browser to confirm when clean", async () => {
    renderEditor(false, createBrowserHistory());
    await screen.findByRole("heading", { name: "編集画面" });
    const cleanEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });
});
