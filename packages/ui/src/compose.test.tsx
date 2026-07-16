import * as stylex from "@stylexjs/stylex";
import { describe, expect, it } from "vitest";
import { stylexRenderProps } from "./compose";

const styles = stylex.create({
  base: { color: "red" },
  pressed: { color: "blue" },
});

describe("stylexRenderProps (StyleX コンパイルのカナリア兼、状態→スタイル合成の唯一の経路)", () => {
  it("compiles stylex.create at transform time and yields class names", () => {
    // vitest.config の @stylexjs/unplugin が transform していれば create は throw しない。
    // ここが「stylex.create should never be called at runtime」等で落ちる場合、テスト
    // パイプラインで StyleX が未コンパイル — 作業を止めてコントローラへ報告すること
    // （フォールバック導入はコントローラの裁定事項）。
    const className = stylex.props(styles.base).className ?? "";
    expect(className.length).toBeGreaterThan(0);
  });

  it("resolves render-prop state into a merged className", () => {
    const resolve = stylexRenderProps<{ isPressed: boolean }>((state) => [
      styles.base,
      state.isPressed && styles.pressed,
    ]);
    const idle = resolve({ isPressed: false });
    const pressed = resolve({ isPressed: true });
    expect(idle.length).toBeGreaterThan(0);
    expect(pressed).not.toBe(idle);
  });
});
