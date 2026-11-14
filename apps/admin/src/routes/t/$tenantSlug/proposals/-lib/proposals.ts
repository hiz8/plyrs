import { titleFieldKey, type ContentTypeDefinition } from "@plyrs/metamodel";
import type { ProposalKind, ProposalState, ProposalSummary } from "~/lib/api-contracts";
import { actorLabel, PROPOSAL_LABELS, viaLabel, type MemberName } from "~/features/records";
import type { Operation } from "~/lib/permissions";

// 16.8(M5c、決定 57): 提案画面の純関数。表示の文言と見出し(router と React に依存しない)

export function kindLabel(kind: ProposalKind): string {
  return PROPOSAL_LABELS.kind[kind];
}

export function stateLabel(state: ProposalState): string {
  return PROPOSAL_LABELS.state[state];
}

function titleFromInput(
  input: Record<string, unknown> | null | undefined,
  definition: ContentTypeDefinition | undefined,
): string | undefined {
  if (input === null || input === undefined) {
    return undefined;
  }
  const titleKey = definition === undefined ? undefined : titleFieldKey(definition);
  for (const key of [titleKey, "title", "name"]) {
    if (key === undefined) continue;
    const value = input[key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return undefined;
}

// 一覧の見出し: create は提案の input のタイトル、他は同期の record のタイトル(labelForRecord)。
// どちらも無ければ recordId の先頭 8 桁(同期の record が消えている delete など)
export function proposalTitle(
  proposal: Pick<ProposalSummary, "kind" | "recordId" | "type"> & {
    input?: Record<string, unknown> | null;
  },
  definition: ContentTypeDefinition | undefined,
  recordTitle: string | undefined,
): string {
  const fromInput =
    proposal.kind === "create" ? titleFromInput(proposal.input, definition) : undefined;
  return fromInput ?? recordTitle ?? proposal.recordId.slice(0, 8);
}

// 「○○ が MCP から 3 フィールドの更新を提案」のような 1 行
export function summarizeProposal(
  proposal: ProposalSummary,
  members: readonly MemberName[] = [],
): string {
  return PROPOSAL_LABELS.summary(
    actorLabel(proposal.actor, members),
    viaLabel(proposal.via),
    proposal.kind,
    proposal.changedFields.length,
  );
}

export function openProposalsFor(
  items: readonly ProposalSummary[],
  recordId: string,
): ProposalSummary[] {
  return items.filter((p) => p.state === "open" && p.recordId === recordId);
}

// 採用に要る操作(画面の出し分け。守りは API 側の proposal_accept が行う)
export function acceptOperationFor(
  kind: ProposalKind,
): Extract<Operation, "record:write" | "record:delete" | "record:publish"> {
  switch (kind) {
    case "create":
    case "update":
      return "record:write";
    case "delete":
      return "record:delete";
    case "publish":
    case "unpublish":
      return "record:publish";
  }
}
