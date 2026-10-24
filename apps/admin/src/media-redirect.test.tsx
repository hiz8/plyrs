import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { bootstrapped, renderAt, socketHarness } from "./test-utils/records-harness";
import { ASSET_1, mediaRoutes } from "./test-utils/media-harness";

vi.mock("./components/media/media-filter-select", async () => {
  const mock = await import("./test-utils/media-filter-select-mock");
  return { MediaFilterSelect: mock.MediaFilterSelectMock };
});

it.each([`/t/blog/content/asset/${ASSET_1}`, `/t/blog/records/asset/${ASSET_1}`])(
  "%s はメディアの詳細へ転送される",
  async (path) => {
    const harness = socketHarness();
    const router = renderAt(path, harness, mediaRoutes());
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), []);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/t/blog/media/${ASSET_1}`));
    expect(await screen.findByRole("heading", { level: 1, name: "メディア" })).toBeInTheDocument();
  },
);
