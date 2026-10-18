import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import { SearchField } from "./search-field";

function Harness() {
  const [value, setValue] = useState("");
  return (
    <SearchField
      label="お知らせを検索"
      placeholder="お知らせを検索"
      value={value}
      onChange={setValue}
    />
  );
}

it("入力中だけ消去ボタンを出し、押すか Esc で消す", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const box = screen.getByRole("searchbox", { name: "お知らせを検索" });
  expect(screen.queryByRole("button", { name: "検索語を消す" })).not.toBeInTheDocument();
  await user.type(box, "キャンペーン");
  await user.click(screen.getByRole("button", { name: "検索語を消す" }));
  expect(box).toHaveValue("");
  await user.type(box, "秋");
  await user.keyboard("{Escape}");
  expect(box).toHaveValue("");
});
