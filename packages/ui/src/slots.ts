import type { ComponentType } from "react";

// design-spec §9.9（論点P）: 管理画面コアが定義する拡張スロットの語彙。2026-07-16 裁定の
// 最小初版 = nav:item のみ実配線し、record-editor:* は Phase 6b で実配線済み。
// home:widget は管理画面 UX 再構築(案 B 2.5)で追加した語彙で、ホームの画面(V4)が描画する。
// 語彙を増やすときは SlotContributions にキーを足す（登録機構は不変）。

interface SlotContributionBase {
  /** スロット内で一意。モジュール名前空間を推奨（例: "core.content-types", "booking.calendar"） */
  id: string;
  /** 昇順で並ぶ。同順位は id の辞書順 */
  order: number;
}

/**
 * 案 A 4 章: nav:item を置くサイドバーの場所。"module:<モジュール ID>" はそのモジュールの
 * 見出しの下、"settings" は設定の下。未指定の項目は中段(主要な機能)の最後に置く。
 */
export type NavGroup = `module:${string}` | "settings";

export interface NavItemContribution extends SlotContributionBase {
  label: string;
  /**
   * TanStack Router のルートパス（例: "/t/$tenantSlug/settings/content-types"）。
   *
   * 契約: 描画側（/t/$tenantSlug レイアウト）は `params` に `tenantSlug` を重ねて束縛する
   * （tenantSlug は現在のテナントで常に上書きされ、contribution からは変えられない）。
   * $typeKey 等の追加パラメータを持つルート（例: /t/$tenantSlug/content/$typeKey）は
   * `params` でその値を渡す（案 A 4 章）。
   */
  to: string;
  /** `$tenantSlug` 以外のパスパラメータ（例: `{ typeKey: "booking.slot" }`） */
  params?: Readonly<Record<string, string>>;
  group?: NavGroup;
}

// Phase 6b で実配線済み: record 編集画面のサイドパネル（コアの core.publication が実例）。
// render は /t/$tenantSlug 配下のエディタルートでのみ描画される。ルート context
// （tenant / adminApi / queryClient）は getRouteApi("/t/$tenantSlug") で取得できる。
export interface RecordEditorPanelContribution extends SlotContributionBase {
  title: string;
  render: ComponentType<{ typeKey: string; recordId: string }>;
}

// Phase 6b で実配線済み: record 編集画面のツールバーアクション
// （コアの core.publish / core.status が実例）。
export interface RecordEditorToolbarContribution extends SlotContributionBase {
  render: ComponentType<{ typeKey: string; recordId: string }>;
}

// 案 B 2.5: ホームに差し込む枠(WordPress のダッシュボードウィジェット相当。例: 予約の
// 「今日の予約」)。record-editor:panel と同じくタイトルと描画部品を持ち、ルート context は
// getRouteApi("/t/$tenantSlug") で取得する。
export interface HomeWidgetContribution extends SlotContributionBase {
  title: string;
  render: ComponentType;
}

export interface SlotContributions {
  "nav:item": NavItemContribution;
  "home:widget": HomeWidgetContribution;
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
