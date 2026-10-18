import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { RelativeTime } from "./relative-time";

it("相対表記は time 要素で、フォーカスで日時のツールチップを出す", async () => {
  render(
    <RelativeTime
      value={{ text: "10 分前", absolute: "2026/10/17 10:00", iso: "2026-10-17T01:00:00.000Z" }}
    />,
  );
  const time = screen.getByText("10 分前");
  expect(time.tagName).toBe("TIME");
  expect(time).toHaveAttribute("dateTime", "2026-10-17T01:00:00.000Z");
  await userEvent.tab();
  expect(await screen.findByRole("tooltip")).toHaveTextContent("2026/10/17 10:00");
});

it("7 日より前は日時をそのまま出し、ツールチップもフォーカスも持たない", () => {
  render(
    <RelativeTime
      value={{
        text: "2026/08/01 09:30",
        absolute: "2026/08/01 09:30",
        iso: "2026-08-01T00:30:00.000Z",
      }}
    />,
  );
  expect(screen.getByText("2026/08/01 09:30")).not.toHaveAttribute("tabindex");
});
