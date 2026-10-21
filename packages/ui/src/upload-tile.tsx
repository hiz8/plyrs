import * as stylex from "@stylexjs/stylex";
import { Check, CircleAlert, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./badge";
import { Button } from "./button";
import { ICON_SIZE } from "./icon";
import { Spinner } from "./progress";
import { accent, bg, border, font, radius, space, status, stroke, text } from "./semantic.stylex";

// F9・F10(D3 M6・M10)。TileGrid のタイルと同じ寸法・角丸・名前
const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    minWidth: 0,
    fontFamily: font.family,
  },
  widthMd: { width: { default: "160px", [NARROW]: "100%" } },
  widthSm: { width: { default: "140px", [NARROW]: "100%" } },
  frame: {
    position: "relative",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    width: "100%",
    aspectRatio: "1",
    padding: space.inset,
    overflow: "hidden",
    textAlign: "center",
    fontSize: font.caption,
    color: text.muted,
    backgroundColor: bg.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
  },
  uploading: { borderColor: accent.default },
  error: { borderColor: status.danger, backgroundColor: status.dangerSurface },
  done: { padding: 0 },
  errorIcon: { display: "inline-flex", color: status.danger },
  message: { fontWeight: font.weightMedium, color: text.default },
  badge: { position: "absolute", right: space.sm, bottom: space.sm, display: "inline-flex" },
  // 読み上げ専用(視覚的に隠す)
  srOnly: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  name: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: font.familyMono,
    fontSize: font.caption,
    color: text.muted,
  },
});

export type UploadTileState =
  | { kind: "queued" }
  | { kind: "uploading" }
  | { kind: "failed"; message: string; onRetry: () => void }
  /** 送る前に弾いた(20 MB 超えなど)。detail は「24.8 MB」 */
  | { kind: "rejected"; message: string; detail?: string; onRemove: () => void }
  | { kind: "done" };

export interface UploadTileProps {
  name: string;
  state: UploadTileState;
  size?: "md" | "sm";
  /** done のときの画像(無ければ bg.surface) */
  thumb?: ReactNode;
}

const UPLOADING_LABEL = "送信しています…";

export function UploadTile({ name, state, size = "md", thumb }: UploadTileProps) {
  const isError = state.kind === "failed" || state.kind === "rejected";
  return (
    <div
      role="group"
      aria-label={name}
      {...stylex.props(styles.root, size === "sm" ? styles.widthSm : styles.widthMd)}
    >
      <div
        {...stylex.props(
          styles.frame,
          state.kind === "uploading" && styles.uploading,
          isError && styles.error,
          state.kind === "done" && styles.done,
        )}
      >
        {state.kind === "queued" && <span aria-live="polite">順番待ち</span>}
        {state.kind === "uploading" && (
          <>
            {/* 文字は見える側(aria-live)だけを読み上げ対象にする */}
            <span aria-hidden="true">
              <Spinner label={UPLOADING_LABEL} />
            </span>
            <span aria-live="polite" {...stylex.props(styles.srOnly)}>
              {UPLOADING_LABEL}
            </span>
          </>
        )}
        {isError && (
          <>
            <span aria-hidden="true" {...stylex.props(styles.errorIcon)}>
              <CircleAlert size={ICON_SIZE.inline} />
            </span>
            <span role="alert" {...stylex.props(styles.message)}>
              {state.message}
            </span>
            {state.kind === "rejected" && state.detail !== undefined && <span>{state.detail}</span>}
            {state.kind === "failed" ? (
              <Button variant="dangerLink" size="sm" icon={RotateCw} onPress={state.onRetry}>
                再試行
              </Button>
            ) : (
              <Button variant="dangerLink" size="sm" onPress={state.onRemove}>
                取り除く
              </Button>
            )}
          </>
        )}
        {state.kind === "done" && (
          <>
            {thumb}
            <span {...stylex.props(styles.badge)}>
              <Badge tone="success" icon={Check}>
                完了
              </Badge>
            </span>
          </>
        )}
      </div>
      <span {...stylex.props(styles.name)} title={name}>
        {name}
      </span>
    </div>
  );
}
