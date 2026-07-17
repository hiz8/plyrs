import * as stylex from "@stylexjs/stylex";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";

const styles = stylex.create({
  dialog: {
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.danger,
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    fontSize: typography.sizeMd,
  },
  title: { fontWeight: 600 },
  fieldKey: { fontWeight: 600 },
  excerpt: { margin: 0, color: colors.textMuted },
  actions: { display: "flex", gap: spacing.sm },
});

export interface ConflictChoice {
  fieldKey: string;
  /** 自分の版の抜粋(プレーンテキスト) */
  mine: string;
  /** サーバー版(= 手元 store の最新 record)の抜粋 */
  theirs: string;
}

// design-spec §10.4 / 裁定 3(2026-07-17): 本文競合は自動マージせず二択で手動解決する。
// conflict ack にサーバー現在値は入らない(ロードマップ §7)ため、突き合わせ相手は手元
// store の最新 record — サーバーは他者の change を ack より先に配信するので一致する。
export function ConflictDialog({
  conflicts,
  onKeepMine,
  onAdoptServer,
}: {
  conflicts: ConflictChoice[];
  onKeepMine: () => void;
  onAdoptServer: () => void;
}) {
  return (
    <div role="alertdialog" aria-label="本文の競合" {...stylex.props(styles.dialog)}>
      <span {...stylex.props(styles.title)}>
        他の編集者が本文を変更しています。どちらの版を残すか選んでください。
      </span>
      {conflicts.map((conflict) => (
        <div key={conflict.fieldKey}>
          <span {...stylex.props(styles.fieldKey)}>{conflict.fieldKey}</span>
          <p {...stylex.props(styles.excerpt)}>自分の版: {conflict.mine}</p>
          <p {...stylex.props(styles.excerpt)}>サーバー版: {conflict.theirs}</p>
        </div>
      ))}
      <div {...stylex.props(styles.actions)}>
        <Button onPress={onKeepMine}>自分の版で上書き保存</Button>
        <Button variant="secondary" onPress={onAdoptServer}>
          サーバー版を採用
        </Button>
      </div>
    </div>
  );
}
