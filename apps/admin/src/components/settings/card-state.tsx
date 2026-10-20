import * as stylex from "@stylexjs/stylex";
import { RotateCw } from "lucide-react";
import { Button, Skeleton } from "@plyrs/ui";
import { font, space, status } from "@plyrs/ui/semantic.stylex";
import { SETTINGS_LABELS } from "../../lib/labels";

const styles = stylex.create({
  loading: { display: "flex", flexDirection: "column", gap: space.sm },
  error: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.sm },
  alert: { margin: 0, fontSize: font.body, color: status.danger },
});

const ROW_WIDTHS = ["100%", "80%", "60%"] as const;

// 設定のカードや本文の読み込み中(読み上げない)
export function CardLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" {...stylex.props(styles.loading)}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={14} width={ROW_WIDTHS[index % ROW_WIDTHS.length] ?? "100%"} />
      ))}
    </div>
  );
}

// 設定のカードや本文の取得失敗。文と再試行をまとめて出す
export function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div {...stylex.props(styles.error)}>
      <p role="alert" {...stylex.props(styles.alert)}>
        {message}
      </p>
      <Button variant="link" size="sm" icon={RotateCw} onPress={onRetry}>
        {SETTINGS_LABELS.retry}
      </Button>
    </div>
  );
}
