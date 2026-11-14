import { useEffect } from "react";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

// F 3.3: 受け口(FileDropTarget / DropZone)の外にファイルを落とすと、ブラウザがそのファイルを開いて
// SPA から離れ、進行中のアップロードも止まる。ファイルのドラッグだけを window で受けて既定動作を止める。
// 受け口の中へのドロップは RAC が stopPropagation して自前で処理するので影響しない
export function useFileDropGuard(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    };
    const onDrop = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [enabled]);
}
