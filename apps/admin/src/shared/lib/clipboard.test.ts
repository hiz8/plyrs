import { toaster } from "@plyrs/ui";
import { afterEach, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";
import { CLIPBOARD_LABELS } from "./labels";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

it("書き込みに成功したら成功のトースト", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const success = vi.spyOn(toaster, "success");
  await copyText("https://example.com");
  expect(writeText).toHaveBeenCalledWith("https://example.com");
  expect(success).toHaveBeenCalledWith(CLIPBOARD_LABELS.copied);
});

it("clipboard が無ければエラーのトースト", async () => {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  const error = vi.spyOn(toaster, "error");
  await copyText("x");
  expect(error).toHaveBeenCalledWith(CLIPBOARD_LABELS.copyFailed);
});
