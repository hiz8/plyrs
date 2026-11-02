import { describe, expect, it } from "vitest";
import { conflictModeFor, VIAS } from "./via";

describe("conflictModeFor(決定 42)", () => {
  it("同期は merge、MCP と REST は strict", () => {
    expect(conflictModeFor("sync")).toBe("merge");
    expect(conflictModeFor("mcp")).toBe("strict");
    expect(conflictModeFor("rest")).toBe("strict");
  });

  it("経路の列挙は 3 つ", () => {
    expect(VIAS).toEqual(["sync", "mcp", "rest"]);
  });
});
