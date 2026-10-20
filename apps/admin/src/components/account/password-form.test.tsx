import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PasswordForm } from "./password-form";

function setup(props: Partial<Parameters<typeof PasswordForm>[0]> = {}) {
  const onSubmit = vi.fn();
  render(
    <PasswordForm onSubmit={onSubmit} isPending={false} fieldErrors={{}} resetKey={0} {...props} />,
  );
  return { onSubmit, user: userEvent.setup() };
}

const current = () => screen.getByLabelText("現在のパスワード");
const next = () => screen.getByLabelText("新しいパスワード", { selector: "input" });
const confirm = () => screen.getByLabelText("新しいパスワード(確認)");
const submit = () => screen.getByRole("button", { name: "パスワードを変更" });

it("3 つとも入るまで無効で、12 文字未満と不一致はフィールドの下に出す", async () => {
  const { onSubmit, user } = setup();
  expect(submit()).toBeDisabled();
  await user.type(current(), "old-password");
  await user.type(next(), "short");
  expect(submit()).toBeDisabled();
  await user.type(confirm(), "short");
  expect(submit()).toBeEnabled();
  await user.click(submit());
  expect(await screen.findByText("12 文字以上で入力してください")).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  await user.clear(next());
  await user.type(next(), "long-enough-password");
  await user.click(submit());
  expect(await screen.findByText("新しいパスワードが一致しません")).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("通れば onSubmit に現在と新しいパスワードを渡し、fieldErrors は該当の欄に出る", async () => {
  const { onSubmit, user } = setup({
    fieldErrors: { current: "現在が違う", next: "新しいが同じ" },
  });
  expect(current()).toHaveAttribute("autocomplete", "current-password");
  expect(next()).toHaveAttribute("autocomplete", "new-password");
  expect(screen.getByText("現在が違う")).toBeInTheDocument();
  expect(screen.getByText("新しいが同じ")).toBeInTheDocument();
  await user.type(current(), "old-password");
  await user.type(next(), "long-enough-password");
  await user.type(confirm(), "long-enough-password");
  await user.click(submit());
  expect(onSubmit).toHaveBeenCalledWith("old-password", "long-enough-password");
});

it("欄を打ち直すと、その欄の API の誤りとローカルの不一致の文が消える", async () => {
  const onClearFieldError = vi.fn();
  const { user } = setup({ fieldErrors: { current: "現在が違う" }, onClearFieldError });
  await user.type(current(), "x");
  expect(onClearFieldError).toHaveBeenCalledWith("current");
  await user.type(next(), "long-enough-password");
  await user.type(confirm(), "different-password");
  await user.click(submit());
  expect(await screen.findByText("新しいパスワードが一致しません")).toBeInTheDocument();
  await user.type(confirm(), "!");
  expect(screen.queryByText("新しいパスワードが一致しません")).not.toBeInTheDocument();
});
