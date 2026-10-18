import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "./checkbox";
import { CheckboxGroup } from "./checkbox-group";

describe("Checkbox", () => {
  it("toggles through onChange", async () => {
    const onChange = vi.fn();
    render(
      <Checkbox isSelected={false} onChange={onChange}>
        必須
      </Checkbox>,
    );
    await userEvent.setup().click(screen.getByRole("checkbox", { name: "必須" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("一部選択は mixed として読み上げる", () => {
    render(
      <Checkbox isSelected={false} isIndeterminate onChange={() => {}}>
        すべて
      </Checkbox>,
    );
    // RAC は native input の indeterminate プロパティで mixed を伝える(aria-checked は付けない)
    expect(screen.getByRole("checkbox", { name: "すべて" })).toBePartiallyChecked();
  });
});

describe("CheckboxGroup", () => {
  const options = [
    { value: "tech", label: "Tech" },
    { value: "life", label: "Life" },
  ];

  it("reflects and updates the selected values", async () => {
    const onChange = vi.fn();
    render(<CheckboxGroup label="タグ" options={options} value={["tech"]} onChange={onChange} />);
    expect(screen.getByRole("checkbox", { name: "Tech" })).toBeChecked();
    await userEvent.setup().click(screen.getByRole("checkbox", { name: "Life" }));
    expect(onChange).toHaveBeenCalledWith(["tech", "life"]);
  });

  it("shows the error message", () => {
    render(
      <CheckboxGroup
        label="タグ"
        options={options}
        value={[]}
        onChange={() => {}}
        errorMessage="必須です"
      />,
    );
    expect(screen.getByText("必須です")).toBeInTheDocument();
  });

  it("links the error message to the group via aria-describedby", () => {
    render(
      <CheckboxGroup
        label="タグ"
        options={options}
        value={[]}
        onChange={() => {}}
        errorMessage="必須です"
      />,
    );
    const group = screen.getByRole("group", { name: "タグ" });
    const describedBy = group.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")).toHaveTextContent("必須です");
  });

  it("エラーのときはグループに説明を結び、各チェックボックスを invalid にする", () => {
    render(
      <CheckboxGroup
        label="公開先"
        options={[{ value: "web", label: "Web" }]}
        value={[]}
        onChange={() => {}}
        errorMessage="1 つ以上選んでください"
      />,
    );
    const group = screen.getByRole("group", { name: "公開先" });
    expect(group).toHaveAccessibleDescription("1 つ以上選んでください");
    expect(screen.getByRole("checkbox", { name: "Web" })).toHaveAttribute("aria-invalid", "true");
  });

  it("omits aria-describedby when there is no error", () => {
    render(<CheckboxGroup label="タグ" options={options} value={[]} onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "タグ" })).not.toHaveAttribute("aria-describedby");
  });
});
