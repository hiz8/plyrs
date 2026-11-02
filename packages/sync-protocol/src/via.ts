// design-spec 16.4 / 16.6(用語集「経路(via)」「判定モード(strict)」): 書き込み・読み取りがどこから来たか。
// 操作カタログの提供先(apps/api/src/ops)、変更履歴の記録(16.5)、競合判定のモードの選択(16.6)で
// 共通に使う列挙。別々に作らない。トークンの種別(tokenKind: pat / oauth)とは別の概念
// (MCP 経由ならどちらの種別でも via は "mcp")。
export const VIAS = ["sync", "mcp", "rest"] as const;
export type Via = (typeof VIAS)[number];

// 判定モード(決定 42): 管理画面の同期は現行どおり(別フィールドはマージ、同一スカラーは LWW、
// 同一リッチテキストは conflict)。エージェント経路(MCP)と REST は strict(changedFields の
// どれか 1 つでも版が違えばスカラーも conflict)。人の直前の編集を黙って上書きさせないため
export type ConflictMode = "merge" | "strict";

export function conflictModeFor(via: Via): ConflictMode {
  return via === "sync" ? "merge" : "strict";
}
