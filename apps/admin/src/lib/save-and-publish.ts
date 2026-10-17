import { useCallback, useRef, useState } from "react";

// 案 C 4 章: 「公開 / 更新」は 検証 → (未保存の編集があれば)保存の確定待ち → 公開 の順に行う。
// 公開処理(api の publishRecordCore)は DO に保存済みのレコードを公開するため、保存の確定
// (tx.isPersisted)を待てば編集内容が公開に含まれる。段階ごとの失敗を呼び出し側が表示し分け
// られるよう、どの段階で止まったかを返す。

export interface SaveAndPublishSteps {
  /** 同期が切断中なら保存が確定しないため、何もせずに止める */
  connected: boolean;
  /** フォームの検証。false なら何も保存・公開しない */
  validate: () => boolean | Promise<boolean>;
  /** 未保存の編集を保存し、確定(tx.isPersisted)まで待つ。編集が無ければ undefined */
  save: (() => Promise<void>) | undefined;
  publish: () => Promise<void>;
  /** 公開前から公開中だったか(結果を「公開しました」と「更新しました」に分ける) */
  wasPublished: boolean;
}

export type SaveAndPublishResult =
  | { ok: true; outcome: "published" | "updated" }
  | { ok: false; stage: "offline" }
  | { ok: false; stage: "validate" }
  // conflict: 本文の競合。既存の競合ダイアログで解決してから、利用者がもう一度押す
  | { ok: false; stage: "save"; conflict: boolean; cause: unknown }
  // 保存は確定済み。再試行は公開だけを行う
  | { ok: false; stage: "publish"; cause: unknown };

function isConflict(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code: unknown }).code === "conflict"
  );
}

export async function publishOnly(
  steps: Pick<SaveAndPublishSteps, "publish" | "wasPublished">,
): Promise<SaveAndPublishResult> {
  try {
    await steps.publish();
  } catch (cause) {
    return { ok: false, stage: "publish", cause };
  }
  return { ok: true, outcome: steps.wasPublished ? "updated" : "published" };
}

export async function saveAndPublish(steps: SaveAndPublishSteps): Promise<SaveAndPublishResult> {
  if (!steps.connected) {
    return { ok: false, stage: "offline" };
  }
  if (!(await steps.validate())) {
    return { ok: false, stage: "validate" };
  }
  if (steps.save !== undefined) {
    try {
      await steps.save();
    } catch (cause) {
      return { ok: false, stage: "save", conflict: isConflict(cause), cause };
    }
  }
  return publishOnly(steps);
}

export type SaveAndPublishPhase = "idle" | "saving" | "publishing";

export interface SaveAndPublishState {
  phase: SaveAndPublishPhase;
  /** 直近の実行結果(実行中・未実行は null) */
  result: SaveAndPublishResult | null;
  run: (steps: SaveAndPublishSteps) => Promise<SaveAndPublishResult>;
  /** 公開の段階で失敗したときだけ使える。保存は確定済みのため公開だけをやり直す */
  retryPublish: () => Promise<SaveAndPublishResult> | null;
}

// 公開ボックス(V3)が使う。実行中の段階(ボタンの表示)と、公開だけの再試行を持つ。
export function useSaveAndPublish(): SaveAndPublishState {
  const [phase, setPhase] = useState<SaveAndPublishPhase>("idle");
  const [result, setResult] = useState<SaveAndPublishResult | null>(null);
  const lastSteps = useRef<SaveAndPublishSteps | null>(null);
  const running = useRef(false);

  const execute = useCallback(async (steps: SaveAndPublishSteps, publishOnlyRetry: boolean) => {
    running.current = true;
    lastSteps.current = steps;
    setResult(null);
    const tracked: SaveAndPublishSteps = {
      ...steps,
      save:
        steps.save === undefined
          ? undefined
          : async () => {
              setPhase("saving");
              await steps.save?.();
            },
      publish: async () => {
        setPhase("publishing");
        await steps.publish();
      },
    };
    try {
      const next = publishOnlyRetry ? await publishOnly(tracked) : await saveAndPublish(tracked);
      setResult(next);
      return next;
    } finally {
      running.current = false;
      setPhase("idle");
    }
  }, []);

  const run = useCallback((steps: SaveAndPublishSteps) => execute(steps, false), [execute]);

  const retryPublish = useCallback(() => {
    const steps = lastSteps.current;
    if (running.current || steps === null || result?.ok !== false || result.stage !== "publish") {
      return null;
    }
    return execute(steps, true);
  }, [execute, result]);

  return { phase, result, run, retryPublish };
}
