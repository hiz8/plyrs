import * as stylex from "@stylexjs/stylex";
import { Upload } from "lucide-react";
import {
  DropZone as RacDropZone,
  FileTrigger,
  Text,
  type DropZoneRenderProps,
} from "react-aria-components";
import { Button } from "./button";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE, ICON_STROKE } from "./icon";
import { accent, border, focus, font, radius, space, stroke, text } from "./semantic.stylex";

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
  disabled: { opacity: 0.5 },
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
}

export function DropZone({
  onFiles,
  acceptedFileTypes,
  allowsMultiple = true,
  title = "ここにファイルをドロップ",
  description,
  buttonLabel = "ファイルを選択",
  isDisabled,
}: DropZoneProps) {
  return (
    <RacDropZone
      isDisabled={isDisabled ?? false}
      getDropOperation={(types) =>
        acceptedFileTypes === undefined || acceptedFileTypes.some((type) => types.has(type))
          ? "copy"
          : "cancel"
      }
      onDrop={async (event) => {
        const files: File[] = [];
        for (const item of event.items) {
          if (item.kind === "file") files.push(await item.getFile());
        }
        if (files.length > 0) onFiles(allowsMultiple ? files : files.slice(0, 1));
      }}
      className={stylexRenderProps<DropZoneRenderProps>((state) => [
        styles.zone,
        state.isDropTarget && styles.dropTarget,
        state.isFocusVisible && styles.focusVisible,
        state.isDisabled && styles.disabled,
      ])}
    >
      {({ isDropTarget }) => (
        <>
          <Upload size={ICON_SIZE.empty} strokeWidth={ICON_STROKE.large} aria-hidden="true" />
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
              if (list !== null && list.length > 0) onFiles(Array.from(list));
            }}
          >
            <Button variant="secondary" isDisabled={isDisabled ?? false}>
              {buttonLabel}
            </Button>
          </FileTrigger>
        </>
      )}
    </RacDropZone>
  );
}
