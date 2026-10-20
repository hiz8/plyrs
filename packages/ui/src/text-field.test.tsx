import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TextField } from "./text-field";

describe("TextField (react-aria-components + StyleX)", () => {
  it("associates the label with the input and accepts typing", async () => {
    render(<TextField label="メールアドレス" name="email" type="email" />);
    const input = screen.getByLabelText("メールアドレス");
    await userEvent.type(input, "a@example.com");
    expect(input).toHaveValue("a@example.com");
  });

  it("shows the error message when invalid", () => {
    render(<TextField label="パスワード" isInvalid errorMessage="12文字以上にしてください" />);
    expect(screen.getByText("12文字以上にしてください")).toBeInTheDocument();
  });

  it("does not render an error when valid", () => {
    render(<TextField label="名前" />);
    expect(screen.queryByText("12文字以上にしてください")).not.toBeInTheDocument();
  });

  it("renders a placeholder and a description hint when provided", () => {
    render(
      <TextField
        label="日時"
        placeholder="2026-10-01T00:20:00Z"
        description="UTC の Z 終端 ISO 8601 形式で入力してください"
      />,
    );
    expect(screen.getByPlaceholderText("2026-10-01T00:20:00Z")).toBeInTheDocument();
    expect(screen.getByText("UTC の Z 終端 ISO 8601 形式で入力してください")).toBeInTheDocument();
  });

  it("surfaces validate-derived errors when errorMessage is omitted", async () => {
    render(
      <form>
        <TextField
          label="コード"
          name="code"
          validate={(value) => (value === "ok" ? null : "コードが不正です")}
        />
        <button type="submit">送信</button>
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(await screen.findByText("コードが不正です")).toBeInTheDocument();
  });
});

describe("TextField の D1 の見た目", () => {
  it("必須の札は見えるが、アクセシブルな名前には混ざらない", () => {
    render(<TextField label="タイトル" isRequired />);
    expect(screen.getByLabelText("タイトル")).toBeRequired();
    expect(screen.getByText("必須")).toHaveAttribute("aria-hidden", "true");
  });

  it("エラーはアイコン付きで出し、入力欄を invalid にする", () => {
    render(<TextField label="タイトル" isInvalid errorMessage="タイトルを入力してください" />);
    expect(screen.getByLabelText("タイトル")).toHaveAttribute("aria-invalid", "true");
    const error = screen.getByText("タイトルを入力してください");
    expect(error.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("フォーカスで枠線のクラスを変えず、リングのクラスだけを足す", async () => {
    render(<TextField label="タイトル" />);
    const input = screen.getByLabelText("タイトル");
    const before = input.className.split(" ");
    await userEvent.tab();
    expect(input).toHaveFocus();
    const after = input.className.split(" ");
    // 足されるだけで、元のクラス(枠線色を含む)は 1 つも消えない
    expect(before.every((name) => after.includes(name))).toBe(true);
    expect(after.length).toBeGreaterThan(before.length);
  });
});

it("isReadOnly は入力を受け付けず readonly 属性を持つ", async () => {
  render(<TextField label="タイトル" value="初期値" onChange={() => {}} isReadOnly />);
  const input = screen.getByRole("textbox", { name: "タイトル" });
  expect(input).toHaveAttribute("readonly");
  await userEvent.setup().type(input, "x");
  expect(input).toHaveValue("初期値");
});
