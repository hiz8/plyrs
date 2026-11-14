import { describe, expect, it, vi } from "vitest";
import { runBulk } from "./bulk";

describe("runBulk", () => {
  it("runs sequentially, continues after failures and reports progress", async () => {
    const order: string[] = [];
    const progress = vi.fn();
    const boom = new Error("boom");
    const result = await runBulk(
      ["a", "b", "c"],
      async (id) => {
        order.push(id);
        if (id === "b") {
          throw boom;
        }
      },
      { onProgress: progress },
    );
    expect(order).toStrictEqual(["a", "b", "c"]);
    expect(result).toStrictEqual({
      succeeded: ["a", "c"],
      failed: [{ id: "b", cause: boom }],
      skipped: [],
    });
    expect(progress.mock.calls).toStrictEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("does not start the next item before the previous one settles", async () => {
    let running = 0;
    let maxRunning = 0;
    await runBulk(["a", "b", "c"], async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await Promise.resolve();
      running -= 1;
    });
    expect(maxRunning).toBe(1);
  });
});

describe("runBulk の中止", () => {
  it("signal の中止で残りを skipped にし、処理済みは戻さない", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const result = await runBulk(
      ["a", "b", "c"],
      async (id) => {
        calls.push(id);
        if (id === "a") {
          controller.abort();
        }
      },
      { signal: controller.signal },
    );
    expect(calls).toEqual(["a"]);
    expect(result).toEqual({ succeeded: ["a"], failed: [], skipped: ["b", "c"] });
  });
});
