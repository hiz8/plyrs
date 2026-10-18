import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./select";

describe("Select", () => {
  const items = [
    { value: "draft", label: "下書き" },
    { value: "ready", label: "公開準備完了" },
  ];

  it("opens the listbox and selects an item", async () => {
    const onChange = vi.fn();
    render(<Select label="ステータス" items={items} selectedValue="draft" onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /ステータス/ }));
    await user.click(await screen.findByRole("option", { name: "公開準備完了" }));
    expect(onChange).toHaveBeenCalledWith("ready");
  });

  it("shows the placeholder when nothing is selected", () => {
    render(
      <Select
        label="型"
        items={items}
        selectedValue=""
        onChange={() => {}}
        placeholder="(未設定)"
      />,
    );
    expect(screen.getByRole("button", { name: /(未設定)/ })).toBeInTheDocument();
  });

  it("選択中の候補に check のアイコンを付け、他の候補は付けない", async () => {
    const user = userEvent.setup();
    render(
      <Select
        label="型"
        items={[
          { value: "news", label: "お知らせ" },
          { value: "event", label: "イベント" },
        ]}
        selectedValue="news"
        onChange={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /型/ }));
    const selected = await screen.findByRole("option", { name: "お知らせ" });
    expect(selected.querySelector("svg.lucide-check")).not.toBeNull();
    expect(
      screen.getByRole("option", { name: "イベント" }).querySelector("svg.lucide-check"),
    ).toBeNull();
  });

  it("エラー文をアイコン付きで出す", () => {
    render(
      <Select
        label="型"
        items={[]}
        selectedValue=""
        onChange={() => {}}
        errorMessage="型を選んでください"
      />,
    );
    expect(screen.getByText("型を選んでください").querySelector("svg")).not.toBeNull();
  });
});

it("トリガーには選択中の文字だけを出し、候補の check 用の枠を持ち込まない", () => {
  render(
    <Select
      label="型"
      items={[{ value: "news", label: "お知らせ" }]}
      selectedValue="news"
      onChange={() => {}}
    />,
  );
  const value = screen.getByRole("button", { name: /型/ }).querySelector(".react-aria-SelectValue");
  expect(value).toHaveTextContent("お知らせ");
  expect(value?.children).toHaveLength(0);
});
