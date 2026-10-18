import { useBlocker } from "@tanstack/react-router";
import { useCallback, useRef } from "react";

// 案 C 7 章: フォームに未保存の編集がある状態で画面を離れようとしたら確認する。
// アプリ内の遷移は useBlocker で止め、確認ダイアログ(V3)は戻り値の status / proceed / reset で
// 描画する。タブを閉じる・再読み込みはブラウザ標準の確認(beforeunload)に任せる。
//
// アプリ自身が行う遷移(初回保存の確定後に編集画面の URL へ移る、削除後に一覧へ戻る など)は
// dirty の解消より先に走るため、navigate({ ignoreBlocker: true }) で通す(案 C 6 章)。
export function useLeaveGuard(dirty: boolean) {
  // 判定関数を固定し、再レンダーのたびに useBlocker が history.block を張り直さないようにする。
  // 判定は遷移の時点の dirty を ref から読む
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const isDirty = useCallback(() => dirtyRef.current, []);
  return useBlocker({
    shouldBlockFn: isDirty,
    enableBeforeUnload: isDirty,
    withResolver: true,
  });
}
