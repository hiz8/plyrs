import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ROLE_DESCRIPTIONS } from "../../lib/labels";
import { RoleCards } from "./role-cards";

it("3 つのロールの説明を出す", () => {
  render(<RoleCards />);
  for (const name of ["管理者", "編集者", "閲覧者"]) {
    expect(screen.getByText(name)).toBeInTheDocument();
  }
  expect(screen.getByText(ROLE_DESCRIPTIONS.owner)).toBeInTheDocument();
  expect(screen.getByText(ROLE_DESCRIPTIONS.editor)).toBeInTheDocument();
  expect(screen.getByText(ROLE_DESCRIPTIONS.viewer)).toBeInTheDocument();
});
