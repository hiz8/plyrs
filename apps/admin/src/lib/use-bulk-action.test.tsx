import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { bulkResultMessage, useBulkAction } from "./use-bulk-action";

describe("useBulkAction", () => {
  it("一部失敗を failure に残し、retry は失敗分だけを呼ぶ", async () => {
    const { result } = renderHook(() => useBulkAction());
    const action = vi.fn(async (id: string) => {
      if (id === "b") {
        throw new Error("x");
      }
    });
    await act(() => result.current.run("publish", ["a", "b"], action));
    expect(result.current.failure).toEqual({ kind: "publish", ids: ["b"] });
    expect(result.current.progress).toBeNull();
    action.mockClear();
    await act(async () => {
      await result.current.retry();
    });
    expect(action.mock.calls.map(([id]) => id)).toEqual(["b"]);
  });

  it("failure が無ければ retry は null", () => {
    const { result } = renderHook(() => useBulkAction());
    expect(result.current.retry()).toBeNull();
  });

  it("cancel で残りを skipped にする", async () => {
    const { result } = renderHook(() => useBulkAction());
    const calls: string[] = [];
    let promise!: ReturnType<typeof result.current.run>;
    act(() => {
      promise = result.current.run("delete", ["a", "b", "c"], async (id) => {
        calls.push(id);
        if (id === "a") {
          result.current.cancel();
        }
      });
    });
    const res = await act(() => promise);
    expect(calls).toEqual(["a"]);
    expect(res).toEqual({ succeeded: ["a"], failed: [], skipped: ["b", "c"] });
  });

  it("実行中の run は二重実行せず同じ Promise を返す", async () => {
    const { result } = renderHook(() => useBulkAction());
    const action = vi.fn(async () => {});
    let first!: ReturnType<typeof result.current.run>;
    let second!: ReturnType<typeof result.current.run>;
    act(() => {
      first = result.current.run("publish", ["a"], action);
      second = result.current.run("publish", ["b"], action);
    });
    expect(second).toBe(first);
    await act(() => first);
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe("bulkResultMessage", () => {
  it("全成功", () => {
    expect(
      bulkResultMessage("publish", { succeeded: ["a", "b"], failed: [], skipped: [] }),
    ).toEqual({ tone: "success", title: "2 件を公開しました" });
  });
  it("一部失敗", () => {
    expect(
      bulkResultMessage("publish", {
        succeeded: ["a"],
        failed: [{ id: "b", cause: 1 }],
        skipped: ["c"],
      }),
    ).toEqual({ tone: "danger", title: "1 件を公開しました。1 件は公開できませんでした" });
  });
  it("全失敗", () => {
    expect(
      bulkResultMessage("publish", {
        succeeded: [],
        failed: [{ id: "b", cause: 1 }],
        skipped: [],
      }),
    ).toEqual({ tone: "danger", title: "1 件は公開できませんでした" });
  });
});
