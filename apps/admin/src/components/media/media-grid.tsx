import * as stylex from "@stylexjs/stylex";
import { Badge, ICON_SIZE, TileGrid, UploadTile, type UploadTileState } from "@plyrs/ui";
import { border, font, radius, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import { Upload } from "lucide-react";
import { ERROR_MESSAGES, errorMessage } from "../../lib/error-messages";
import { MEDIA_LABELS } from "../../lib/labels";
import { formatBytes, type MediaRow } from "../../lib/media-list";
import type { UploadEntry } from "../../lib/use-uploads";
import { MediaThumb, type MediaThumbProps } from "./media-thumb";

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", flex: 1, gap: space.md },
  // F3.3: 常時のドロップ案内。グリッドの最下部に寄せる
  hint: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    marginTop: "auto",
    padding: space.inset,
    fontSize: font.caption,
    color: text.muted,
    borderWidth: stroke.focus,
    borderStyle: "dashed",
    borderColor: border.default,
    borderRadius: radius.container,
  },
});

export interface MediaGridProps {
  rows: readonly MediaRow[];
  resolveUrl: MediaThumbProps["resolveUrl"];
  /** null = 取得前・失敗(バッジ無し) */
  orphanIds: ReadonlySet<string> | null;
  /** 先頭の仮タイル(UploadsSnapshot.entries) */
  uploads: readonly UploadEntry[];
  onRetryUpload: (key: string) => void;
  onRemoveUpload: (key: string) => void;
  /** undefined = 選択なし(viewer) */
  selection:
    | {
        selectedKeys: ReadonlySet<string>;
        onSelectionChange: (keys: Set<string>) => void;
        isDisabled: boolean;
      }
    | undefined;
  onOpen: (id: string) => void;
  showDropHint: boolean;
}

export function uploadTileState(
  entry: UploadEntry,
  handlers: { onRetry: () => void; onRemove: () => void },
): UploadTileState {
  const { item } = entry;
  if (item.status !== "failed") return { kind: item.status };
  if (item.reason === "error") {
    return {
      kind: "failed",
      message: errorMessage(item.cause, MEDIA_LABELS.upload.failed),
      onRetry: handlers.onRetry,
    };
  }
  const code = item.reason === "empty" ? "empty_body" : item.reason;
  return {
    kind: "rejected",
    message: ERROR_MESSAGES[code] ?? MEDIA_LABELS.upload.failed,
    ...(item.reason === "too_large" ? { detail: formatBytes(item.file.size) } : {}),
    onRemove: handlers.onRemove,
  };
}

export function MediaGrid({
  rows,
  resolveUrl,
  orphanIds,
  uploads,
  onRetryUpload,
  onRemoveUpload,
  selection,
  onOpen,
  showDropHint,
}: MediaGridProps) {
  return (
    <div {...stylex.props(styles.root)}>
      <TileGrid
        label={MEDIA_LABELS.gridLabel}
        size="md"
        items={rows.map((row) => ({ row, id: row.id, textValue: row.filename }))}
        renderThumb={({ row }) => <MediaThumb row={row} resolveUrl={resolveUrl} size="tile" />}
        renderBadge={({ row }) =>
          orphanIds?.has(row.id) === true ? (
            <Badge tone="warning">{MEDIA_LABELS.unused}</Badge>
          ) : null
        }
        selectionMode={selection === undefined ? "none" : "multiple"}
        selectedKeys={selection?.selectedKeys ?? new Set<string>()}
        {...(selection === undefined ? {} : { onSelectionChange: selection.onSelectionChange })}
        onAction={onOpen}
        disabledKeys={
          selection?.isDisabled === true ? new Set(rows.map((row) => row.id)) : new Set<string>()
        }
        leading={uploads.map((entry) => (
          <UploadTile
            key={entry.key}
            name={entry.item.file.name}
            state={uploadTileState(entry, {
              onRetry: () => onRetryUpload(entry.key),
              onRemove: () => onRemoveUpload(entry.key),
            })}
          />
        ))}
      />
      {showDropHint && (
        <div {...stylex.props(styles.hint)}>
          <Upload size={ICON_SIZE.inline} aria-hidden="true" />
          {MEDIA_LABELS.dropHint}
        </div>
      )}
    </div>
  );
}
