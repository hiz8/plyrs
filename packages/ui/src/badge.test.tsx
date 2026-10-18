import { render, screen } from "@testing-library/react";
import { Globe } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";

describe("Badge(D1 ボード 3d)", () => {
  it("文字を必ず出し、点とアイコンは読み上げない", () => {
    render(
      <>
        <Badge tone="success" dot>
          公開中
        </Badge>
        <Badge tone="success" icon={Globe}>
          公開中(大)
        </Badge>
      </>,
    );
    const dotted = screen.getByText("公開中");
    expect(dotted.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByText("公開中(大)").querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("色ごとにクラスが変わる", () => {
    const { rerender } = render(<Badge tone="neutral">下書き</Badge>);
    const neutral = screen.getByText("下書き").className;
    rerender(<Badge tone="accent">下書き</Badge>);
    expect(screen.getByText("下書き").className).not.toBe(neutral);
  });
});
