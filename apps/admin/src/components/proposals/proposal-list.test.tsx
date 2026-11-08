import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ProposalSummary } from "../../lib/api-contracts";
import { ProposalList } from "./proposal-list";

// 16.8(M5c): 提案の一覧の行

const RECORD = "018f2b6a-7a0a-7000-8000-000000000001";
const AGENT = "018f2b6a-7a0a-7000-8000-0000000000aa";

const summary = (overrides: Partial<ProposalSummary> = {}): ProposalSummary => ({
  id: "018f2b6a-7a0a-7000-8000-0000000000f1",
  recordId: RECORD,
  type: "article",
  kind: "update",
  state: "open",
  changedFields: ["title"],
  status: null,
  currentStatus: "draft",
  baseVersion: 2,
  currentVersion: 2,
  stale: false,
  note: null,
  actor: AGENT,
  via: "mcp",
  tokenId: "tok",
  createdAt: "2026-11-07T00:00:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
  resolutionNote: null,
  resultHistorySeq: null,
  ...overrides,
});

describe("ProposalList", () => {
  it("提案ごとに見出し・種別・要約・stale のバッジを出し、行は詳細へのリンク", () => {
    const items = [
      summary(),
      summary({ id: "018f2b6a-7a0a-7000-8000-0000000000f2", kind: "publish", stale: true }),
    ];
    render(
      <ProposalList
        items={items}
        hrefOf={(p) => `/t/blog/proposals/${p.id}`}
        titleOf={() => "記事のタイトル"}
        members={[{ userId: AGENT, email: "ai@example.com" }]}
        emptyMessage="未処理の提案はありません"
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      "href",
      "/t/blog/proposals/018f2b6a-7a0a-7000-8000-0000000000f1",
    );
    expect(within(links[0] as HTMLElement).getByText("記事のタイトル")).toBeInTheDocument();
    expect(within(links[0] as HTMLElement).getByText("更新")).toBeInTheDocument();
    expect(
      within(links[0] as HTMLElement).getByText(
        "ai@example.com がMCPから 1 フィールドの更新を提案",
      ),
    ).toBeInTheDocument();
    expect(
      within(links[0] as HTMLElement).queryByText("提案の後に内容が変わっています"),
    ).not.toBeInTheDocument();
    expect(within(links[1] as HTMLElement).getByText("公開")).toBeInTheDocument();
    expect(
      within(links[1] as HTMLElement).getByText("提案の後に内容が変わっています"),
    ).toBeInTheDocument();
  });

  it("空なら空の文言だけを出す", () => {
    render(
      <ProposalList
        items={[]}
        hrefOf={() => "#"}
        titleOf={() => ""}
        emptyMessage="未処理の提案はありません"
      />,
    );
    expect(screen.getByText("未処理の提案はありません")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
