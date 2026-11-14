import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { UploadProgressBar } from "./upload-progress-bar";

it("件数と失敗数を出し、残りを中止できる", async () => {
  const onCancel = vi.fn();
  render(<UploadProgressBar done={2} total={5} failed={1} onCancel={onCancel} />);
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("アップロードしています…");
  expect(status).toHaveTextContent("2 / 5 件が完了");
  expect(status).toHaveTextContent("1 件は送れませんでした");
  expect(screen.getByRole("progressbar")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "残りを中止" }));
  expect(onCancel).toHaveBeenCalled();
});

it("失敗が無ければ失敗の文は出ない", () => {
  render(<UploadProgressBar done={0} total={2} failed={0} onCancel={vi.fn()} />);
  expect(screen.getByRole("status")).not.toHaveTextContent("送れませんでした");
});
