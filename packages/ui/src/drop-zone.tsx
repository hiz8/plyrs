import * as stylex from "@stylexjs/stylex";
import { Upload } from "lucide-react";
import {
  DropZone as RacDropZone,
  FileTrigger,
  Text,
  type DropZoneRenderProps,
} from "react-aria-components";
import { Button, DisabledAppearanceInheritedContext } from "./button";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE, ICON_STROKE } from "./icon";
import { accent, bg, border, focus, font, radius, space, stroke, text } from "./semantic.stylex";

// D1 ボード 3e。キーボードでは「ファイルを選択」にフォーカスが移り、Enter で選択が開く
const styles = stylex.create({
  zone: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.sm,
    paddingBlock: space.xl,
    paddingInline: space.lg,
    fontFamily: font.family,
    fontSize: font.caption,
    color: text.muted,
    textAlign: "center",
    borderWidth: stroke.focus,
    borderStyle: "dashed",
    borderColor: border.hover,
    borderRadius: radius.container,
    outline: "none",
  },
  // F16。本文全体に広げ、中身を縦中央に置く
  fill: { flex: 1, minHeight: 0, justifyContent: "center" },
  fillIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "64px",
    height: "64px",
    borderRadius: radius.full,
    backgroundColor: bg.surface,
  },
  dropTarget: {
    borderColor: accent.default,
    backgroundColor: accent.surface,
    color: accent.default,
  },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
  title: { fontSize: font.body, fontWeight: font.weightMedium, color: text.default },
  titleDropTarget: { color: accent.default },
});

export interface DropZoneProps {
  onFiles: (files: File[]) => void;
  /** MIME type(例: image/png) */
  acceptedFileTypes?: string[];
  allowsMultiple?: boolean;
  title?: string;
  /** 受け付ける種類と上限(例: 画像・PDF・動画、1 ファイル 20 MB まで) */
  description?: string;
  buttonLabel?: string;
  isDisabled?: boolean;
  /** 本文全体に広げる(F16)。アイコンは 64px の円に入れる */
  isFill?: boolean;
}

/** ドロップ項目のうち、このファイルで使う最小の形(RAC の DropItem と構造的に互換) */
export interface DroppedItem {
  kind: string;
  getFile?: () => Promise<File>;
}

/**
 * FileTrigger の acceptedFileTypes と同じ規則で判定する。
 * `.ext` は拡張子(大文字小文字を無視)、`type/*` は MIME の前半一致、それ以外は MIME の完全一致
 */
export function acceptsFile(file: File, acceptedFileTypes: string[] | undefined): boolean {
  if (acceptedFileTypes === undefined) return true;
  const name = file.name.toLowerCase();
  return acceptedFileTypes.some((accepted) => {
    if (accepted.startsWith(".")) return name.endsWith(accepted.toLowerCase());
    if (accepted.endsWith("/*")) return file.type.startsWith(accepted.slice(0, -1));
    return file.type === accepted;
  });
}

export async function collectDroppedFiles(
  items: DroppedItem[],
  acceptedFileTypes: string[] | undefined,
  allowsMultiple: boolean,
): Promise<File[]> {
  const files: File[] = [];
  for (const item of items) {
    if (item.kind !== "file" || item.getFile === undefined) continue;
    const file = await item.getFile();
    if (acceptsFile(file, acceptedFileTypes)) files.push(file);
  }
  return allowsMultiple ? files : files.slice(0, 1);
}

export function DropZone({
  onFiles,
  acceptedFileTypes,
  allowsMultiple = true,
  title = "ここにファイルをドロップ",
  description,
  buttonLabel = "ファイルを選択",
  isDisabled,
  isFill = false,
}: DropZoneProps) {
  return (
    <RacDropZone
      isDisabled={isDisabled ?? false}
      // ドラッグ中は MIME の一覧しか見えないため、ワイルドカードと拡張子の指定は onDrop で絞る
      getDropOperation={(types) =>
        acceptedFileTypes === undefined ||
        acceptedFileTypes.some(
          (type) => type.startsWith(".") || type.endsWith("/*") || types.has(type),
        )
          ? "copy"
          : "cancel"
      }
      onDrop={async (event) => {
        const files = await collectDroppedFiles(event.items, acceptedFileTypes, allowsMultiple);
        if (files.length > 0) onFiles(files);
      }}
      className={stylexRenderProps<DropZoneRenderProps>((state) => [
        styles.zone,
        state.isDropTarget && styles.dropTarget,
        state.isFocusVisible && styles.focusVisible,
        state.isDisabled && styles.disabled,
        isFill && styles.fill,
      ])}
    >
      {({ isDropTarget }) => (
        <>
          {isFill ? (
            <span {...stylex.props(styles.fillIcon)}>
              <Upload size={ICON_SIZE.empty} strokeWidth={ICON_STROKE.large} aria-hidden="true" />
            </span>
          ) : (
            <Upload size={ICON_SIZE.empty} strokeWidth={ICON_STROKE.large} aria-hidden="true" />
          )}
          <Text
            slot="label"
            {...stylex.props(styles.title, isDropTarget && styles.titleDropTarget)}
          >
            {isDropTarget ? "ここに置くとアップロードします" : title}
          </Text>
          {description !== undefined && <span>{description}</span>}
          <FileTrigger
            {...(acceptedFileTypes === undefined ? {} : { acceptedFileTypes })}
            allowsMultiple={allowsMultiple}
            onSelect={(list) => {
              if (list === null) return;
              // ブラウザの accept 属性は強制ではないため、ドロップと同じ規則で絞る
              const files = Array.from(list).filter((file) => acceptsFile(file, acceptedFileTypes));
              if (files.length > 0) onFiles(files);
            }}
          >
            {/* 外枠が opacity を持つため、中のボタンは操作だけ止めて opacity を重ねない(0.25 にしない) */}
            <DisabledAppearanceInheritedContext value={isDisabled === true}>
              <Button variant="secondary" isDisabled={isDisabled ?? false}>
                {buttonLabel}
              </Button>
            </DisabledAppearanceInheritedContext>
          </FileTrigger>
        </>
      )}
    </RacDropZone>
  );
}
