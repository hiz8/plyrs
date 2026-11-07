import {
  acceptedContent,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  type CallToolResult,
  type ElicitRequestFormParams,
  type InputRequiredResult,
  type RequestStateCodec,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import type { McpAuth } from "../do/authorize";

// design-spec 16.8(M4-2、決定 50): publish / unpublish の確認。同じ利用者への確認は MRTR の elicitation で
// 行う(サーバーはクライアントに入力を求める結果 input_required を返し、クライアントが答えを付けて同じ要求を
// 送り直す)。stateless なので往復の状態は requestState に入れてクライアントに持たせる。requestState は
// 攻撃者が操作できる入力なので、SDK の HMAC codec で保護し、テナント・利用者・トークンに束縛し、TTL を付け、
// 中身(操作名と recordId)を元の要求と照合する。
// クライアントが elicitation を宣言していなければ、確認できないので拒否して人に回す(所有者の判断)。
// M5c からは、トークンが record:propose を持てば提案(proposal_create)も案内する。

export const CONFIRM_OPERATIONS = ["record_publish", "record_unpublish"] as const;
export type ConfirmOperation = (typeof CONFIRM_OPERATIONS)[number];

export function isConfirmOperation(name: string): name is ConfirmOperation {
  return (CONFIRM_OPERATIONS as readonly string[]).includes(name);
}

export const REQUEST_STATE_TTL_SECONDS = 300;
// 鍵は JWT_SECRET から用途の接頭辞で分ける(新しい secret を足さない)。HMAC の鍵なので
// 接頭辞 + secret の連結で用途が分かれる(requireSaneSecret が 32 字以上を保証する)
const KEY_PREFIX = "plyrs:mcp-request-state:v1:";
const LABEL_LIMIT = 80;

export interface ConfirmState {
  op: ConfirmOperation;
  recordId: string;
  // 確認文を見せたときの record の版と最新の history_seq。承諾後の実行で DO が同じトランザクションの中で
  // 照合し、変わっていれば record_changed にする(見せた内容と違うものを公開させない。公開 → 取り下げの
  // 往復で版が変わらなくても、history_seq は進むので同じ確認を使い回させない)
  version: number;
  historySeq: number;
}

export type ConfirmedExpectation = Pick<ConfirmState, "version" | "historySeq">;

export interface RecordDescription {
  label: string;
  type: string;
  version: number;
  historySeq: number;
}

export function bindOf(tenantId: string, auth: McpAuth): string {
  return `${tenantId}:${auth.userId}:${auth.tokenId}`;
}

// 要求ごとに作る(bind は認可コンテキストを閉じ込める。MCP サーバーも要求ごとに作っている)
export function requestStateCodec(
  secret: string,
  tenantId: string,
  auth: McpAuth,
): RequestStateCodec<ConfirmState> {
  return createRequestStateCodec<ConfirmState>({
    key: `${KEY_PREFIX}${secret}`,
    ttlSeconds: REQUEST_STATE_TTL_SECONDS,
    bind: () => bindOf(tenantId, auth),
  });
}

// 承諾の照合に使うスキーマ。既定値を持たせない(`confirm` が欠けた Accept を確認とみなさない。16.8)
export const confirmSchema = z.object({
  confirm: z.boolean().describe("実行してよければ true"),
});

// M5a-6: クライアントに送るフォームのスキーマ。`confirm` に `default: true` を付け、フォームが初期値を true に
// して描くようにする(G4 で、Claude Code のフォームが boolean の欄を切り替えられず、Accept が declined に
// なった)。照合は confirmSchema のまま、`confirm: true` を明示した Accept だけを確認とする
export const confirmRequestedSchema: ElicitRequestFormParams["requestedSchema"] = {
  type: "object",
  properties: {
    confirm: { type: "boolean", description: "実行してよければ true", default: true },
  },
  required: ["confirm"],
};

// クライアントが要求の _meta で elicitation の能力を宣言しているか(仕様 2026-07-28 は要求ごとに能力を運ぶ)
export function canElicit(envelope: unknown): boolean {
  if (typeof envelope !== "object" || envelope === null) {
    return false;
  }
  const record = envelope as Record<string, unknown>;
  const capabilities =
    record["clientCapabilities"] ?? record["io.modelcontextprotocol/clientCapabilities"];
  return (
    typeof capabilities === "object" &&
    capabilities !== null &&
    (capabilities as Record<string, unknown>)["elicitation"] !== undefined
  );
}

// 人が読む確認文の record 名。改行を潰して切り詰める(本文はエージェントには見せない文面だが、
// 利用者が入れた値なので体裁を崩させない)
export function labelOf(title: unknown, recordId: string): string {
  if (typeof title !== "string" || title.trim() === "") {
    return recordId;
  }
  const flat = title.replaceAll(/\s+/g, " ").trim();
  return flat.length > LABEL_LIMIT ? `${flat.slice(0, LABEL_LIMIT)}…` : flat;
}

function messageOf(op: ConfirmOperation, label: string, type: string, recordId: string): string {
  return op === "record_publish"
    ? `「${label}」(${type} / ${recordId})を公開しますか。公開すると誰でも読めるようになります。`
    : `「${label}」(${type} / ${recordId})の公開を取り下げますか。`;
}

function refused(code: string, message: string, details?: Record<string, unknown>): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `${code}: ${message}` }],
    structuredContent: { error: { code, message, ...(details === undefined ? {} : { details }) } },
  };
}

export type ConfirmOutcome =
  | { kind: "confirmed"; expect: ConfirmedExpectation }
  | { kind: "ask"; result: InputRequiredResult }
  | { kind: "refused"; result: CallToolResult };

export interface ConfirmArgs {
  op: ConfirmOperation;
  recordId: string;
  // record の名前と型は ask のときだけ要る(呼び出し側が record_get で引く)
  describe: () => Promise<RecordDescription | CallToolResult>;
  clientCanElicit: boolean;
  // M5c(決定 57): トークンが record:propose を持つなら、確認できないときの代わりに提案を案内する
  canPropose: boolean;
  inputResponses: Record<string, unknown> | undefined;
  // SDK の verify を通った requestState の中身(無ければ undefined)
  state: ConfirmState | undefined;
  mint: (state: ConfirmState) => Promise<string>;
}

export async function confirmOperation(args: ConfirmArgs): Promise<ConfirmOutcome> {
  if (args.state !== undefined) {
    // 署名は正しくても、別の操作・別の record の確認を流用させない
    if (args.state.op !== args.op || args.state.recordId !== args.recordId) {
      return {
        kind: "refused",
        result: refused(
          "state_mismatch",
          "この確認は別の操作のものです。確認からやり直してください",
        ),
      };
    }
    const confirmed = acceptedContent(args.inputResponses, "confirm", confirmSchema);
    if (confirmed?.confirm === true) {
      const { version, historySeq } = args.state;
      return { kind: "confirmed", expect: { version, historySeq } };
    }
    const view = inputResponse(args.inputResponses, "confirm");
    if (view.kind === "elicit" || confirmed !== undefined) {
      return {
        kind: "refused",
        result: refused("declined", "利用者が実行しないことを選んだ。この操作を繰り返さないこと"),
      };
    }
  }
  if (!args.clientCanElicit) {
    const base =
      "このクライアントは確認(elicitation)に対応していないため公開・取り下げはできません。status を ready にして、管理画面で人が公開してください";
    const kind = args.op === "record_publish" ? "publish" : "unpublish";
    return {
      kind: "refused",
      result: args.canPropose
        ? refused(
            "confirmation_unavailable",
            `${base}。または proposal_create(kind: ${kind})で${kind === "publish" ? "公開" : "取り下げ"}を提案してください`,
            { alternative: "proposal_create" },
          )
        : refused("confirmation_unavailable", base),
    };
  }
  const described = await args.describe();
  if ("content" in described) {
    return { kind: "refused", result: described };
  }
  const requestState = await args.mint({
    op: args.op,
    recordId: args.recordId,
    version: described.version,
    historySeq: described.historySeq,
  });
  return {
    kind: "ask",
    result: inputRequired({
      inputRequests: {
        confirm: inputRequired.elicit({
          message: messageOf(args.op, described.label, described.type, args.recordId),
          requestedSchema: confirmRequestedSchema,
        }),
      },
      requestState,
    }),
  };
}
