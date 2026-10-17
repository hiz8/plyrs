import { useBlocker } from "@tanstack/react-router";

// 案 C 7 章: フォームに未保存の編集がある状態で画面を離れようとしたら確認する。
// アプリ内の遷移は useBlocker で止め、確認ダイアログ(V3)は戻り値の status / proceed / reset で
// 描画する。タブを閉じる・再読み込みはブラウザ標準の確認(beforeunload)に任せる。
export function useLeaveGuard(dirty: boolean) {
  return useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
}
