import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SiteNameForm } from "./site-name-form";

function renderForm(onSave = vi.fn().mockResolvedValue(undefined)) {
  render(<SiteNameForm name="Blog" slug="blog" onSave={onSave} isPending={false} />);
  return onSave;
}

describe("SiteNameForm", () => {
  it("保存は名前を変えるまで無効で、空と 100 字超は理由を出す", async () => {
    const user = userEvent.setup();
    renderForm();
    const save = screen.getByRole("button", { name: "保存" });
    const input = screen.getByRole("textbox", { name: "サイト名" });
    expect(save).toBeDisabled();
    expect(screen.getByText("blog")).toBeInTheDocument();

    await user.clear(input);
    expect(save).toBeDisabled();
    expect(screen.getByText("サイト名を入力してください")).toBeInTheDocument();

    await user.type(input, "あ".repeat(101));
    expect(save).toBeDisabled();
    expect(screen.getByText("サイト名は 100 文字以内で入力してください")).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "Blog 2");
    expect(save).toBeEnabled();
  });

  it("保存すると trim した名前で onSave を呼ぶ", async () => {
    const user = userEvent.setup();
    const onSave = renderForm();
    await user.clear(screen.getByRole("textbox", { name: "サイト名" }));
    await user.type(screen.getByRole("textbox", { name: "サイト名" }), "  新しい名前  ");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith("新しい名前");
  });
});
