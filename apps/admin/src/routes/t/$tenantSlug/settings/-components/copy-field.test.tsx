import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastRegion } from "@plyrs/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyField } from "./copy-field";

function renderField() {
  render(
    <>
      <CopyField label="ベース URL" value="https://api.example/public/v1/blog/" />
      <ToastRegion />
    </>,
  );
}

describe("CopyField", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("コピーを押すと clipboard に書いてトーストを出す", async () => {
    // userEvent.setup() が clipboard を差し替えるので、その後に自前のものを載せる
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderField();
    await user.click(screen.getByRole("button", { name: "ベース URLをコピー" }));
    expect(writeText).toHaveBeenCalledWith("https://api.example/public/v1/blog/");
    expect(
      await within(screen.getByRole("region", { name: "通知" })).findByText("コピーしました"),
    ).toBeInTheDocument();
  });

  it("clipboard が無ければエラーのトースト", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    renderField();
    await user.click(screen.getByRole("button", { name: "ベース URLをコピー" }));
    expect(
      await within(screen.getByRole("region", { name: "通知" })).findByText(
        "コピーできませんでした",
      ),
    ).toBeInTheDocument();
  });
});
