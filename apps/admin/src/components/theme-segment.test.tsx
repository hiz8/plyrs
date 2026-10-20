import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { THEME_STORAGE_KEY } from "../lib/theme";
import { ThemeSegment } from "./theme-segment";

afterEach(() => {
  localStorage.clear();
  document.documentElement.style.colorScheme = "";
});

it("選ぶと記憶してすぐ当てる", async () => {
  const user = userEvent.setup();
  render(<ThemeSegment />);
  await user.click(screen.getByRole("radio", { name: "ダーク" }));
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  expect(document.documentElement.style.colorScheme).toBe("dark");
});
