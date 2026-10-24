import { Button, ModalDialog } from "@plyrs/ui";
import { DIALOGS } from "../lib/labels";
import type { useLeaveGuard } from "../lib/use-leave-guard";

// 未保存の変更を残して画面を離れようとしたときの確認(案 C 7 章)。
// 本文だけ画面ごとに違う(レコードは本文とタイトル、型設計はコンテンツタイプ)
export function LeaveGuardDialog({
  blocker,
  body,
}: {
  blocker: ReturnType<typeof useLeaveGuard>;
  body: string;
}) {
  return (
    <ModalDialog
      title={DIALOGS.leave.title}
      isOpen={blocker.status === "blocked"}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
      role="alertdialog"
      isDismissable={false}
      showCloseButton={false}
      footer={
        <>
          <Button variant="dangerLink" onPress={() => blocker.proceed?.()}>
            {DIALOGS.leave.discard}
          </Button>
          <Button autoFocus onPress={() => blocker.reset?.()}>
            {DIALOGS.leave.stay}
          </Button>
        </>
      }
    >
      <p>{body}</p>
    </ModalDialog>
  );
}
