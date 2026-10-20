import * as stylex from "@stylexjs/stylex";
import { Plus } from "lucide-react";
import { Fragment } from "react";
import { Button, Skeleton } from "@plyrs/ui";
import { border, font, space, text } from "@plyrs/ui/semantic.stylex";
import type { HomeType } from "../../lib/home";
import { HOME_LABELS } from "../../lib/labels";

// b-home.md 2.1: 区切り線は 1px × 24px
const DIVIDER_HEIGHT = "24px";

const styles = stylex.create({
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.sm,
    fontFamily: font.family,
  },
  label: { fontSize: font.body, fontWeight: font.weightBold, color: text.muted },
  divider: {
    width: "1px",
    height: DIVIDER_HEIGHT,
    backgroundColor: border.default,
  },
});

// 裁定 B20: 型ごとの secondary ボタン。利用者の型 → モジュールの型の境目に区切り線
export function QuickAddRow({
  types,
  onAdd,
  isLoading,
}: {
  types: readonly HomeType[];
  onAdd: (typeKey: string) => void;
  isLoading?: boolean;
}) {
  return (
    <div {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.label)}>{HOME_LABELS.quickAdd}</span>
      {isLoading === true ? (
        <>
          <Skeleton shape="circle" width={96} height={32} />
          <Skeleton shape="circle" width={96} height={32} />
          <Skeleton shape="circle" width={96} height={32} />
        </>
      ) : (
        types.map((type, index) => (
          <Fragment key={type.key}>
            {type.group === "module" && types[index - 1]?.group === "content" ? (
              <span aria-hidden="true" data-divider="true" {...stylex.props(styles.divider)} />
            ) : null}
            <Button variant="secondary" size="sm" icon={Plus} onPress={() => onAdd(type.key)}>
              {type.name}
            </Button>
          </Fragment>
        ))
      )}
    </div>
  );
}
