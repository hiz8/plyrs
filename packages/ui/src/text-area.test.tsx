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
});
