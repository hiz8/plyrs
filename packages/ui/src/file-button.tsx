import type { LucideIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { FileTrigger } from "react-aria-components";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { acceptsFile } from "./drop-zone";

export interface FileButtonProps {
  onFiles: (files: File[]) => void;
  /** 既定 true */
  allowsMultiple?: boolean;
  /** DropZone と同じ規則(acceptsFile で絞る) */
  acceptedFileTypes?: string[];
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  isDisabled?: boolean;
  /** ボタンの文言 */
  children: ReactNode;
}

/** ファイル選択のボタン。選択のたびに input の値を空にし、同じファイルを続けて選べるようにする(F39) */
export function FileButton({
  onFiles,
  allowsMultiple = true,
  acceptedFileTypes,
  variant = "secondary",
  size,
  icon,
  isDisabled,
  children,
}: FileButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <FileTrigger
      ref={inputRef}
      {...(acceptedFileTypes === undefined ? {} : { acceptedFileTypes })}
      allowsMultiple={allowsMultiple}
      onSelect={(list) => {
        if (list !== null) {
          // ブラウザの accept 属性は強制ではないため、DropZone と同じ規則で絞る
          const files = Array.from(list).filter((file) => acceptsFile(file, acceptedFileTypes));
          if (files.length > 0) onFiles(files);
        }
        // 同じファイルを続けて選べるよう input を空にする(FileTrigger を作り直すとフォーカスが落ちる)
        if (inputRef.current !== null) inputRef.current.value = "";
      }}
    >
      <Button
        variant={variant}
        {...(size === undefined ? {} : { size })}
        {...(icon === undefined ? {} : { icon })}
        isDisabled={isDisabled ?? false}
      >
        {children}
      </Button>
    </FileTrigger>
  );
}
