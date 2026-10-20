import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { Avatar } from "./avatar";

it("先頭の 1 文字を大文字で出し、読み上げからは外す", () => {
  const { container } = render(<Avatar name="owner@example.com" />);
  const avatar = container.firstElementChild!;
  expect(avatar).toHaveTextContent("O");
  expect(avatar).toHaveAttribute("aria-hidden", "true");
});

it("サロゲートペアの先頭も 1 文字として扱い、空なら ? を出す", () => {
  expect(render(<Avatar name="𠮷野" />).container).toHaveTextContent("𠮷");
  expect(render(<Avatar name="" />).container).toHaveTextContent("?");
});
