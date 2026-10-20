import * as stylex from "@stylexjs/stylex";
import { Button, ModalDialog } from "@plyrs/ui";
import { bg, border, font, radius, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import { formatDateTime } from "../lib/datetime";
import { DIALOGS } from "../lib/labels";

const styles = stylex.create({
  content: {
    // 2 列の比較が収まる、この部品固有の幅(ModalDialog 既定の 440px では狭い)
    width: "760px",
    maxWidth: "100%",
    display: "flex",
    flexDirection: "column",
    gap: space.md,
  },
  description: { margin: 0 },
  field: { display: "flex", flexDirection: "column", gap: space.xs },
  fieldKey: { fontWeight: font.weightBold, color: text.default, fontSize: font.body },
  columns: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: space.sm },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    padding: space.sm,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
    backgroundColor: bg.surface,
    minWidth: 0,
  },
  cardTitle: { margin: 0, fontSize: font.body, fontWeight: font.weightBold, color: text.default },
  cardNote: { margin: 0, fontSize: font.caption, color: text.muted },
  excerpt: {
    margin: 0,
    fontSize: font.body,
    color: text.default,
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
  },
});

export interface ConflictChoice {
  fieldKey: string;
  /** 表示するフィールド名(field.label ?? field.key) */
  label: string;
  /** 自分の版の抜粋(プレーンテキスト) */
  mine: string;
  /** サーバー版(= 手元 store の最新 record)の抜粋 */
  theirs: string;
}

// design-spec §10.4 / 裁定 3(2026-07-17): 本文競合は自動マージせず手動で解決する。R10 でモーダルにした。
// conflict ack にサーバー現在値は入らない(ロードマップ §7)ため、突き合わせ相手は手元
// store の最新 record — サーバーは他者の change を ack より先に配信するので一致する。
export function ConflictDialog({
  isOpen,
  conflicts,
  theirsSavedAt,
  onKeepMine,
  onAdoptTheirs,
  onDecideLater,
}: {
  isOpen: boolean;
  conflicts: ConflictChoice[];
  /** ほかの人が保存した日時(ISO 8601。record.updatedAt) */
  theirsSavedAt: string;
  onKeepMine: () => void;
  onAdoptTheirs: () => void;
  onDecideLater: () => void;
}) {
  const savedAgo = formatDateTime(theirsSavedAt).text;
  return (
    <ModalDialog
      title={DIALOGS.conflict.title}
      isOpen={isOpen}
      // 閉じる操作は 3 つのボタンだけ。Esc や暗幕では閉じない
      onOpenChange={() => {}}
      role="dialog"
      isDismissable={false}
      showCloseButton={false}
      footer={
        <>
          <Button variant="secondary" onPress={onDecideLater}>
            {DIALOGS.conflict.later}
          </Button>
          <Button variant="secondary" onPress={onAdoptTheirs}>
            {DIALOGS.conflict.adoptTheirs}
          </Button>
          <Button variant="primary" autoFocus onPress={onKeepMine}>
            {DIALOGS.conflict.keepMine}
          </Button>
        </>
      }
    >
      <div {...stylex.props(styles.content)}>
        <p {...stylex.props(styles.description)}>{DIALOGS.conflict.body(savedAgo)}</p>
        {conflicts.map((conflict) => (
          <div key={conflict.fieldKey} {...stylex.props(styles.field)}>
            <span {...stylex.props(styles.fieldKey)}>{conflict.label}</span>
            <div {...stylex.props(styles.columns)}>
              <section {...stylex.props(styles.card)}>
                <h3 {...stylex.props(styles.cardTitle)}>{DIALOGS.conflict.mine}</h3>
                <p {...stylex.props(styles.cardNote)}>{DIALOGS.conflict.mineNote}</p>
                <p {...stylex.props(styles.excerpt)}>{conflict.mine}</p>
              </section>
              <section {...stylex.props(styles.card)}>
                <h3 {...stylex.props(styles.cardTitle)}>{DIALOGS.conflict.theirs}</h3>
                <p {...stylex.props(styles.cardNote)}>{DIALOGS.conflict.theirsNote(savedAgo)}</p>
                <p {...stylex.props(styles.excerpt)}>{conflict.theirs}</p>
              </section>
            </div>
          </div>
        ))}
      </div>
    </ModalDialog>
  );
}
