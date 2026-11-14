import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFileDropGuard } from "./use-file-drop-guard";

function fire(type: "dragover" | "drop", types: string[]): Event {
  const event = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperty(event, "dataTransfer", { value: { types, dropEffect: "copy" } });
  window.dispatchEvent(event);
  return event;
}

describe("useFileDropGuard", () => {
  it("Files を含むドラッグだけ既定動作を止め、unmount 後は止めない", () => {
    const { unmount } = renderHook(() => useFileDropGuard());
    expect(fire("dragover", ["Files"]).defaultPrevented).toBe(true);
    expect(fire("drop", ["Files"]).defaultPrevented).toBe(true);
    expect(fire("dragover", ["text/plain"]).defaultPrevented).toBe(false);
    expect(fire("drop", ["text/plain"]).defaultPrevented).toBe(false);
    unmount();
    expect(fire("dragover", ["Files"]).defaultPrevented).toBe(false);
    expect(fire("drop", ["Files"]).defaultPrevented).toBe(false);
  });
});
