import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { saveAndPublish, useSaveAndPublish, type SaveAndPublishSteps } from "./save-and-publish";

function steps(overrides: Partial<SaveAndPublishSteps> = {}): SaveAndPublishSteps {
  return {
    connected: true,
    validate: () => true,
    save: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
    wasPublished: false,
    ...overrides,
  };
}

describe("saveAndPublish (案 C 4 章)", () => {
  it("validates, waits for the save, then publishes", async () => {
    const order: string[] = [];
    const result = await saveAndPublish(
      steps({
        validate: () => {
          order.push("validate");
          return true;
        },
        save: async () => {
          order.push("save");
        },
        publish: async () => {
          order.push("publish");
        },
      }),
    );
    expect(result).toStrictEqual({ ok: true, outcome: "published" });
    expect(order).toStrictEqual(["validate", "save", "publish"]);
  });

  it("reports an update when the record was already published", async () => {
    expect(await saveAndPublish(steps({ wasPublished: true }))).toStrictEqual({
      ok: true,
      outcome: "updated",
    });
  });

  it("skips the save when there is nothing to save", async () => {
    const publish = vi.fn(async () => {});
    expect(await saveAndPublish(steps({ save: undefined, publish }))).toMatchObject({ ok: true });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disconnected", async () => {
    const s = steps({ connected: false });
    expect(await saveAndPublish(s)).toStrictEqual({ ok: false, stage: "offline" });
    expect(s.save).not.toHaveBeenCalled();
    expect(s.publish).not.toHaveBeenCalled();
  });

  it("stops at validation without saving or publishing", async () => {
    const s = steps({ validate: async () => false });
    expect(await saveAndPublish(s)).toStrictEqual({ ok: false, stage: "validate" });
    expect(s.save).not.toHaveBeenCalled();
    expect(s.publish).not.toHaveBeenCalled();
  });

  it("turns a throwing validation into a validate failure", async () => {
    const cause = new Error("boom");
    const s = steps({
      validate: () => {
        throw cause;
      },
    });
    expect(await saveAndPublish(s)).toStrictEqual({ ok: false, stage: "validate", cause });
    expect(s.save).not.toHaveBeenCalled();
    expect(s.publish).not.toHaveBeenCalled();
  });

  it("does not publish when the save fails, and flags body conflicts", async () => {
    const conflict = Object.assign(new Error("conflict"), { code: "conflict" });
    const s = steps({ save: async () => Promise.reject(conflict) });
    expect(await saveAndPublish(s)).toStrictEqual({
      ok: false,
      stage: "save",
      conflict: true,
      cause: conflict,
    });
    expect(s.publish).not.toHaveBeenCalled();

    const other = new Error("network");
    expect(await saveAndPublish(steps({ save: async () => Promise.reject(other) }))).toMatchObject({
      stage: "save",
      conflict: false,
    });
  });

  it("reports a publish failure after the save succeeded", async () => {
    const cause = new Error("publish failed");
    const s = steps({ publish: async () => Promise.reject(cause) });
    expect(await saveAndPublish(s)).toStrictEqual({ ok: false, stage: "publish", cause });
    expect(s.save).toHaveBeenCalledTimes(1);
  });
});

describe("useSaveAndPublish", () => {
  it("exposes the running phase and the result", async () => {
    const release = { save: () => {} };
    const { result } = renderHook(() => useSaveAndPublish());
    expect(result.current.phase).toBe("idle");

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.run(
        steps({
          save: () =>
            new Promise<void>((resolve) => {
              release.save = resolve;
            }),
        }),
      );
    });
    await waitFor(() => expect(result.current.phase).toBe("saving"));
    await act(async () => {
      release.save();
      await pending;
    });
    expect(result.current.phase).toBe("idle");
    expect(result.current.result).toStrictEqual({ ok: true, outcome: "published" });
  });

  it("does not start a second run while one is in flight", async () => {
    const release = { validate: (_valid: boolean) => {} };
    const s = steps({
      validate: () =>
        new Promise<boolean>((resolve) => {
          release.validate = resolve;
        }),
    });
    const { result } = renderHook(() => useSaveAndPublish());

    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      // 検証の await 中は phase が idle のまま。ここで 2 回目が押されても同じ実行を返す
      first = result.current.run(s);
      second = result.current.run(s);
    });
    expect(second).toBe(first);
    await act(async () => {
      release.validate(true);
      await first;
    });
    expect(s.save).toHaveBeenCalledTimes(1);
    expect(s.publish).toHaveBeenCalledTimes(1);
    expect(result.current.result).toStrictEqual({ ok: true, outcome: "published" });
  });

  it("retries only the publish after a publish failure", async () => {
    const save = vi.fn(async () => {});
    const publish = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useSaveAndPublish());

    await act(async () => {
      await result.current.run(steps({ save, publish, wasPublished: true }));
    });
    expect(result.current.result).toMatchObject({ ok: false, stage: "publish" });

    await act(async () => {
      await result.current.retryPublish();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(result.current.result).toStrictEqual({ ok: true, outcome: "updated" });
  });

  it("does not offer a publish retry for other outcomes", async () => {
    const { result } = renderHook(() => useSaveAndPublish());
    expect(result.current.retryPublish()).toBeNull();
    await act(async () => {
      await result.current.run(steps({ validate: () => false }));
    });
    expect(result.current.retryPublish()).toBeNull();
  });
});
