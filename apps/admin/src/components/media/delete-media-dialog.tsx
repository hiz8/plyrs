import { TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "@plyrs/ui";
import { MEDIA_LABELS } from "../../lib/labels";
import { countUsingRecords, type ResolvedUsage } from "../../lib/media";
import { usageTitles, type MediaRow } from "../../lib/media-list";
import { DialogNote } from "../settings/dialog-note";

const L = MEDIA_LABELS.deleteDialog;

export type DeleteMediaTarget =
  | {
      kind: "one";
      row: MediaRow;
      usage:
        | { status: "pending" }
        | { status: "error" }
        | { status: "ready"; entries: readonly ResolvedUsage[] };
    }
  /** inUse が null = 未使用一覧が取れていない(使用中の件数が分からない) */
  | { kind: "many"; ids: string[]; inUse: number | null };

export interface DeleteMediaDialogProps {
  target: DeleteMediaTarget | null;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

// F37: 使用中のファイルを消す前に、使われているコンテンツを見せて警告する
export function DeleteMediaDialog({
  target,
  onConfirm,
  onCancel,
  isPending,
}: DeleteMediaDialogProps) {
  // 閉じるアニメーションの間も題を保つため、直近の対象は持たず isOpen だけで切り替える
  const title =
    target === null
      ? ""
      : target.kind === "one"
        ? L.title(target.row.filename)
        : L.bulkTitle(target.ids.length);
  return (
    <ConfirmDialog
      title={title}
      isOpen={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      confirmLabel={L.confirm}
      tone="danger"
      onConfirm={onConfirm}
      isPending={isPending}
    >
      {target === null ? null : (
        <>
          <p>{L.body}</p>
          {target.kind === "one" ? (
            <OneNote usage={target.usage} />
          ) : (
            <ManyNote inUse={target.inUse} />
          )}
        </>
      )}
    </ConfirmDialog>
  );
}

function OneNote({ usage }: { usage: Extract<DeleteMediaTarget, { kind: "one" }>["usage"] }) {
  if (usage.status === "pending") return <p>{L.checking}</p>;
  if (usage.status === "error") {
    return (
      <DialogNote tone="warning" icon={TriangleAlert}>
        {L.checkFailed}
      </DialogNote>
    );
  }
  const count = countUsingRecords(usage.entries.map((entry) => ({ sourceId: entry.recordId })));
  if (count === 0) return null;
  const { titles, rest } = usageTitles(usage.entries);
  return (
    <DialogNote tone="warning" icon={TriangleAlert}>
      <strong>{L.inUse(count)}</strong>
      {L.inUseTitles(titles, rest)}
      {L.consequence}
    </DialogNote>
  );
}

function ManyNote({ inUse }: { inUse: number | null }) {
  if (inUse === null) {
    return (
      <DialogNote tone="warning" icon={TriangleAlert}>
        {L.checkFailed}
      </DialogNote>
    );
  }
  if (inUse === 0) return null;
  return (
    <DialogNote tone="warning" icon={TriangleAlert}>
      <strong>{L.bulkInUse(inUse)}</strong>
      {L.consequence}
    </DialogNote>
  );
}
