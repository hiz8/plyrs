import { describe, expect, it } from "vitest";
import { runBeforeWriteHooks, type BeforeWriteContext, type BeforeWriteHook } from "./hooks";

const ctx = {} as BeforeWriteContext; // ダミーフックは ctx を参照しない
// 何もキャプチャしないので外側スコープへ（unicorn/consistent-function-scoping）
const first: BeforeWriteHook = () => ({ code: "unique_violation", message: "stop" });

describe("runBeforeWriteHooks", () => {
  it("short-circuits on the first rejection (later hooks not invoked)", () => {
    let secondCalled = false;
    const second: BeforeWriteHook = () => {
      secondCalled = true;
      return null;
    };
    const rejection = runBeforeWriteHooks([first, second], ctx);
    expect(rejection).toEqual({ code: "unique_violation", message: "stop" });
    expect(secondCalled).toBe(false);
  });

  it("runs all hooks when none reject", () => {
    let calls = 0;
    const hook: BeforeWriteHook = () => {
      calls += 1;
      return null;
    };
    expect(runBeforeWriteHooks([hook, hook, hook], ctx)).toBeNull();
    expect(calls).toBe(3);
  });
});
