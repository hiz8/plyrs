import type { ComponentType } from "react";

// design-spec §9.9（論点P）: 管理画面コアが定義する拡張スロットの語彙。2026-07-16 裁定の
// 最小初版 = nav:item のみ実配線し、record-editor:* は Phase 6b で配線する型予約。
// 語彙を増やすときは SlotContributions にキーを足す（登録機構は不変）。

interface SlotContributionBase {
  /** スロット内で一意。モジュール名前空間を推奨（例: "core.content-types", "booking.calendar"） */
  id: string;
  /** 昇順で並ぶ。同順位は id の辞書順 */
  order: number;
}

export interface NavItemContribution extends SlotContributionBase {
  label: string;
  /** TanStack Router のルートパス（例: "/t/$tenantSlug/content-types"）。params は描画側が束縛する */
  to: string;
}

// 型予約（Phase 6b で配線）: record 編集画面のサイドパネル
export interface RecordEditorPanelContribution extends SlotContributionBase {
  title: string;
  render: ComponentType<{ typeKey: string; recordId: string }>;
}

// 型予約（Phase 6b で配線）: record 編集画面のツールバーアクション
export interface RecordEditorToolbarContribution extends SlotContributionBase {
  render: ComponentType<{ typeKey: string; recordId: string }>;
}

export interface SlotContributions {
  "nav:item": NavItemContribution;
  "record-editor:panel": RecordEditorPanelContribution;
  "record-editor:toolbar": RecordEditorToolbarContribution;
}

export type SlotName = keyof SlotContributions;

export interface SlotRegistry {
  register<N extends SlotName>(slot: N, contribution: SlotContributions[N]): void;
  get<N extends SlotName>(slot: N): SlotContributions[N][];
}

export function createSlotRegistry(): SlotRegistry {
  // 値の実型はキーごとに異なるが、Map はキー連動型を表現できないため base で持ち、
  // get の返却時にキー対応型へ戻す（rpc-unwrap と同じ「文書化された境界 cast」）。
  const entries = new Map<SlotName, SlotContributionBase[]>();
  return {
    register(slot, contribution) {
      const list = entries.get(slot) ?? [];
      if (list.some((existing) => existing.id === contribution.id)) {
        throw new Error(`duplicate slot contribution: ${slot} / ${contribution.id}`);
      }
      entries.set(slot, [...list, contribution]);
    },
    get<N extends SlotName>(slot: N) {
      const list = entries.get(slot) ?? [];
      return list.toSorted(
        (a, b) => a.order - b.order || a.id.localeCompare(b.id),
      ) as SlotContributions[N][];
    },
  };
}
