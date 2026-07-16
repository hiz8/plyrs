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
