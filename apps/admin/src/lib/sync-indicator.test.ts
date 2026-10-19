import { expect, it } from "vitest";
import { syncIndicatorState } from "./sync-indicator";

it.each([
  ["idle", false, "syncing"],
  ["connecting", false, "syncing"],
  ["syncing", false, "syncing"],
  ["ready", false, "ready"],
  ["ready", true, "ready"],
  ["connecting", true, "disconnected"],
  ["syncing", true, "disconnected"],
  ["closed", false, "disconnected"],
  ["closed", true, "disconnected"],
] as const)("%s / hasSynced=%s → %s", (status, hasSynced, expected) => {
  expect(syncIndicatorState(status, hasSynced)).toBe(expected);
});
