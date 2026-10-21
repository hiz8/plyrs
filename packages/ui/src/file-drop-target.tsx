import * as stylex from "@stylexjs/stylex";
import { useState, type ReactNode } from "react";
import { DropZone as RacDropZone, type DropZoneRenderProps } from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { collectDroppedFiles } from "./drop-zone";
import { accent, font, radius, space, stroke, text } from "./semantic.stylex";

// F35(D3 M5)。画面全体のドロップ。ドラッグ中だけ children の上に暗幕を重ねる
const styles = stylex.create({
  zone: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    outline: "none",
  },
  // 外側の入れ物。RAC DropZone は DOM のドラッグイベントを受けないため、ここで dragenter を拾う
  outer: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
  curtain: {
    position: "absolute",
    inset: space.inset,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
    fontFamily: font.family,
    // 地の不透明度(color-mix は使わず、重ねる div に opacity)
    opacity: 0.92,
    backgroundColor: accent.surface,
    borderWidth: stroke.focus,
    borderStyle: "dashed",
    borderColor: accent.default,
    borderRadius: radius.container,
    pointerEvents: "none",
  },
  title: {
    fontSize: font.sectionTitle,
    fontWeight: font.weightBold,
    color: accent.default,
  },
  caption: { fontSize: font.caption, color: text.muted },
});

export interface FileDropTargetProps {
  onFiles: (files: File[]) => void;
  /** true: ドロップを受けず暗幕も出さない(素の入れ物) */
  isDisabled?: boolean;
  /** 暗幕の 2 行目の固定部分(「1 ファイル 20 MB まで」)。件数は部品が前に付ける */
  hint: string;
  children: ReactNode;
}

function countOf(event: { dataTransfer?: DataTransfer | null }): number | null {
  const length = event.dataTransfer?.items?.length ?? 0;
  return length > 0 ? length : null;
}

export function FileDropTarget({
  onFiles,
  isDisabled = false,
  hint,
  children,
}: FileDropTargetProps) {
  const [count, setCount] = useState<number | null>(null);

  if (isDisabled) return <div {...stylex.props(styles.zone)}>{children}</div>;

  return (
    <div
      {...stylex.props(styles.outer)}
      onDragEnterCapture={(event) => setCount(countOf(event))}
      onDragLeave={(event) => {
        // 子要素への出入りでは消さない。relatedTarget が無い環境(Safari・旧 Chrome)でも消さず、
        // drop / dragend で戻す
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) setCount(null);
      }}
      onDropCapture={() => setCount(null)}
      onDragEnd={() => setCount(null)}
    >
      <RacDropZone
        getDropOperation={() => "copy"}
        onDrop={async (event) => {
          const files = await collectDroppedFiles(event.items, undefined, true);
          if (files.length > 0) onFiles(files);
        }}
        className={stylexRenderProps<DropZoneRenderProps>(() => [styles.zone])}
      >
        {({ isDropTarget }) => (
          <>
            {children}
            {isDropTarget && (
              <div role="status" {...stylex.props(styles.curtain)}>
                <span {...stylex.props(styles.title)}>ここに置くとアップロードします</span>
                <span {...stylex.props(styles.caption)}>
                  {count === null ? hint : `${count} ファイル ・ ${hint}`}
                </span>
              </div>
            )}
          </>
        )}
      </RacDropZone>
    </div>
  );
}
