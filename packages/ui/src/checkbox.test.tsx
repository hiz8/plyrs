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

  it("必須は group に許されない aria-required を使わず、説明として「必須」を結ぶ(エラーと併記)", () => {
    const { rerender } = render(
      <CheckboxGroup label="タグ" options={options} value={[]} onChange={() => {}} isRequired />,
    );
    const group = screen.getByRole("group", { name: "タグ" });
    expect(group).not.toHaveAttribute("aria-required");
    expect(group).toHaveAccessibleDescription("必須");
    rerender(
      <CheckboxGroup
        label="タグ"
        options={options}
        value={[]}
        onChange={() => {}}
        isRequired
        errorMessage="1 つ以上選んでください"
      />,
    );
    expect(group).toHaveAccessibleDescription("必須 1 つ以上選んでください");
  });

  it("omits aria-describedby when there is no error", () => {
    render(<CheckboxGroup label="タグ" options={options} value={[]} onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "タグ" })).not.toHaveAttribute("aria-describedby");
  });
});

it("Checkbox の isReadOnly は aria-readonly を持ち、押しても onChange が呼ばれない", async () => {
  const onChange = vi.fn();
  render(
    <Checkbox isSelected onChange={onChange} isReadOnly>
      必須
    </Checkbox>,
  );
  const box = screen.getByRole("checkbox", { name: "必須" });
  expect(box).toHaveAttribute("aria-readonly", "true");
  await userEvent.setup().click(box);
  expect(onChange).not.toHaveBeenCalled();
});

it("CheckboxGroup の isReadOnly は中のチェックを読み取り専用にする", async () => {
  const onChange = vi.fn();
  render(
    <CheckboxGroup
      label="タグ"
      options={[{ value: "tech", label: "技術" }]}
      value={["tech"]}
      onChange={onChange}
      isReadOnly
    />,
  );
  const box = screen.getByRole("checkbox", { name: "技術" });
  expect(box).toHaveAttribute("aria-readonly", "true");
  await userEvent.setup().click(box);
  expect(onChange).not.toHaveBeenCalled();
});
