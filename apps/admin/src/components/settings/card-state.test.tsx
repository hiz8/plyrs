import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CardError } from "./card-state";

describe("CardError", () => {
  it("alert の文が出て、再試行で onRetry が呼ばれる", async () => {
    const onRetry = vi.fn();
    render(<CardError message="読み込めませんでした" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("読み込めませんでした");
    await userEvent.setup().click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
