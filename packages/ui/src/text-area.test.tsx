import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TextArea } from "./text-area";

describe("TextArea", () => {
  it("renders a labelled textarea and propagates changes", async () => {
    const onChange = vi.fn();
    render(<TextArea label="JSON" value="" onChange={onChange} rows={4} />);
    const area = screen.getByRole("textbox", { name: "JSON" });
    await userEvent.setup().type(area, "{{");
    expect(onChange).toHaveBeenCalled();
  });

  it("shows the error message when invalid", () => {
    render(
      <TextArea
        label="JSON"
        value="x"
        onChange={() => {}}
        isInvalid
        errorMessage="JSON として解釈できません"
      />,
    );
    expect(screen.getByText("JSON として解釈できません")).toBeInTheDocument();
  });

  it("必須の札はアクセシブルな名前に混ざらない", () => {
    render(<TextArea label="概要" value="" onChange={() => {}} isRequired />);
    expect(screen.getByLabelText("概要")).toBeRequired();
  });
});

it("isReadOnly は入力を受け付けず readonly 属性を持つ", async () => {
  render(<TextArea label="概要" value="初期値" onChange={() => {}} isReadOnly />);
  const area = screen.getByRole("textbox", { name: "概要" });
  expect(area).toHaveAttribute("readonly");
  await userEvent.setup().type(area, "x");
  expect(area).toHaveValue("初期値");
});
