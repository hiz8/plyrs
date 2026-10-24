import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PageBody } from "./tenant-page-header";

// F16: isFill は高さを渡す style(flex: 1 など)を足す。実寸の確認は jsdom ではできない
it("isFill のときだけ、本文を残りの高さに広げるクラスが付く", () => {
  render(
    <>
      <PageBody>
        <span>plain</span>
      </PageBody>
      <PageBody isFill>
        <span>fill</span>
      </PageBody>
    </>,
  );
  const plain = screen.getByText("plain").parentElement as HTMLElement;
  const fill = screen.getByText("fill").parentElement as HTMLElement;
  expect(fill.classList.length).toBeGreaterThan(plain.classList.length);
  for (const name of plain.classList) expect(fill.classList.contains(name)).toBe(true);
});
