import { describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import {
  acceptOperationFor,
  openProposalsFor,
  proposalTitle,
  summarizeProposal,
} from "./proposals";
import type { ProposalSummary } from "~/lib/api-contracts";

// 16.8(M5c): 提案画面の純関数

const RECORD = "018f2b6a-7a0a-7000-8000-000000000001";
const AGENT = "018f2b6a-7a0a-7000-8000-0000000000aa";
const members = [{ userId: AGENT, email: "ai@example.com" }];

const summary = (overrides: Partial<ProposalSummary> = {}): ProposalSummary => ({
  id: "018f2b6a-7a0a-7000-8000-0000000000f1",
  recordId: RECORD,
  type: "article",
  kind: "update",
  state: "open",
  changedFields: ["title", "body"],
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

const definition = {
  key: "article",
  name: "記事",
  titleField: "headline",
  fields: [
    { key: "headline", label: "見出し", type: "text" },
    { key: "body", label: "本文", type: "richtext" },
  ],
} as unknown as ContentTypeDefinition;

describe("proposalTitle", () => {
  it("create は input のタイトルのフィールド、無ければ title / name、それも無ければ recordId の先頭 8 桁", () => {
    expect(
      proposalTitle(
        { kind: "create", recordId: RECORD, type: "article", input: { headline: "A" } },
        definition,
        undefined,
      ),
    ).toBe("A");
    expect(
      proposalTitle(
        { kind: "create", recordId: RECORD, type: "article", input: { title: "B" } },
        undefined,
        undefined,
      ),
    ).toBe("B");
    expect(
      proposalTitle(
        { kind: "create", recordId: RECORD, type: "article", input: {} },
        definition,
        undefined,
      ),
    ).toBe(RECORD.slice(0, 8));
  });

  it("create 以外は同期の record のタイトル、無ければ recordId の先頭 8 桁", () => {
    expect(proposalTitle(summary(), definition, "既存の記事")).toBe("既存の記事");
    expect(proposalTitle(summary({ kind: "delete" }), definition, undefined)).toBe(
      RECORD.slice(0, 8),
    );
  });
});

describe("summarizeProposal", () => {
  it("「○○ がMCPから 2 フィールドの更新を提案」のように提案者・経路・種別を 1 行にする", () => {
    expect(summarizeProposal(summary(), members)).toBe(
      "ai@example.com がMCPから 2 フィールドの更新を提案",
    );
    expect(summarizeProposal(summary({ kind: "publish", via: "rest" }), members)).toBe(
      "ai@example.com がAPIから公開を提案",
    );
    // メンバーに無い actor は ID の先頭 8 桁
    expect(summarizeProposal(summary({ kind: "delete" }))).toBe(
      `${AGENT.slice(0, 8)} がMCPから削除を提案`,
    );
  });
});

describe("openProposalsFor / acceptOperationFor", () => {
  it("record で絞り、未処理だけを返す", () => {
    const other = summary({
      id: "018f2b6a-7a0a-7000-8000-0000000000f2",
      recordId: "018f2b6a-7a0a-7000-8000-000000000002",
    });
    const resolved = summary({ id: "018f2b6a-7a0a-7000-8000-0000000000f3", state: "accepted" });
    expect(openProposalsFor([summary(), other, resolved], RECORD).map((p) => p.id)).toEqual([
      summary().id,
    ]);
  });

  it("採用に要る操作は種別で決まる", () => {
    expect(acceptOperationFor("create")).toBe("record:write");
    expect(acceptOperationFor("update")).toBe("record:write");
    expect(acceptOperationFor("delete")).toBe("record:delete");
    expect(acceptOperationFor("publish")).toBe("record:publish");
    expect(acceptOperationFor("unpublish")).toBe("record:publish");
  });
});
