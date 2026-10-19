import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { type BreadcrumbItem, Breadcrumbs } from "./breadcrumbs";
import { border, font, size, space, stroke, text } from "./semantic.stylex";

// h-common-surface.md 2 章 / D1 ボード 4: パンくず → 見出し行(h1 + 補助操作 + 主操作)。
// 切断時の接続バナーはヘッダーと本文の間に挟む。編集画面の主操作は公開ボックスに置く(案 C)ため、
// primaryAction を渡さない
// 幅 960px 未満では余白を詰める(table.tsx と同じ値。StyleX 0.19.1 に defineConsts が無いのでファイルごとの定数)
const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  header: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    paddingTop: space.lg,
    paddingBottom: space.md,
    paddingInline: { default: space.pageGutter, [NARROW]: space.md },
    fontFamily: font.family,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  titleRow: { display: "flex", alignItems: "center", gap: space.md, minWidth: 0 },
  title: {
    flex: 1,
    minWidth: 0,
    // ボタンの高さに揃える
    minHeight: size.control,
    display: "flex",
    alignItems: "center",
    margin: 0,
    fontSize: font.pageTitle,
    fontWeight: font.weightBold,
    lineHeight: font.lineHeightTight,
    color: text.default,
  },
  titleText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  actions: { display: "flex", alignItems: "center", gap: space.sm, flexShrink: 0 },
});

export interface PageHeaderProps {
  title: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  /** 塗りのボタン 1 つ(新規追加・保存など) */
  primaryAction?: ReactNode;
  /** 枠線のボタン。主操作の左に置く */
  secondaryActions?: ReactNode;
  /** 切断時の接続バナー(V2 でシェルが渡す) */
  banner?: ReactNode;
}

export function PageHeader({
  title,
  breadcrumbs,
  primaryAction,
  secondaryActions,
  banner,
}: PageHeaderProps) {
  const hasActions = primaryAction !== undefined || secondaryActions !== undefined;
  return (
    <>
      <header {...stylex.props(styles.header)}>
        {breadcrumbs !== undefined && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
        <div {...stylex.props(styles.titleRow)}>
          <h1 {...stylex.props(styles.title)}>
            <span
              title={typeof title === "string" ? title : undefined}
              {...stylex.props(styles.titleText)}
            >
              {title}
            </span>
          </h1>
          {hasActions && (
            <div {...stylex.props(styles.actions)}>
              {secondaryActions}
              {primaryAction}
            </div>
          )}
        </div>
      </header>
      {banner}
    </>
  );
}
