import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProposalDiff } from "./proposal-diff";

// 16.8(M5c): 提案の差分。フィールドの差分に加えて、提案するワークフロー状態も行に出す

describe("ProposalDiff", () => {
  it("status の提案は「状態」の行に 現在 → 提案 で出て、フィールドが無くても「同じ内容」にしない", () => {
    render(
      <ProposalDiff
        kind="update"
        fields={[]}
        definition={undefined}
        status="ready"
        currentStatus="draft"
      />,
    );
    const row = screen.getByRole("row", { name: /状態/ });
    expect(within(row).getByText("下書き")).toBeInTheDocument();
    expect(within(row).getByText("公開準備完了")).toBeInTheDocument();
    expect(screen.queryByText("現在と同じ内容です")).not.toBeInTheDocument();
  });

  it("status を変えない提案では状態の行を出さない", () => {
    render(
      <ProposalDiff
        kind="update"
        fields={[]}
        definition={undefined}
        status={null}
        currentStatus="draft"
      />,
    );
    expect(screen.queryByRole("row", { name: /状態/ })).not.toBeInTheDocument();
    expect(screen.getByText("現在と同じ内容です")).toBeInTheDocument();
  });
});
