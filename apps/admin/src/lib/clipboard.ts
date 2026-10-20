import { toaster } from "@plyrs/ui";
import { CLIPBOARD_LABELS } from "./labels";

// クリップボードへ書き、結果をトーストで知らせる。未対応・拒否はエラーのトースト
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard === undefined) {
      throw new Error("clipboard unavailable");
    }
    await navigator.clipboard.writeText(text);
    toaster.success(CLIPBOARD_LABELS.copied);
  } catch {
    toaster.error(CLIPBOARD_LABELS.copyFailed);
  }
}
