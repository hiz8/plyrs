import * as stylex from "@stylexjs/stylex";
import type { LucideIcon } from "lucide-react";
import { Fragment, useId, type ReactNode } from "react";
import { Link, type LinkRenderProps } from "react-aria-components";
import { ICON_SIZE, ICON_STROKE, Skeleton, stylexRenderProps } from "@plyrs/ui";
import { bg, border, focus, font, radius, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import type { HomeType, StatusSummary, TypeCount } from "../../lib/home";
import { HOME_LABELS } from "../../lib/labels";

const NARROW = "@media (max-width: 959px)";

// b-home.md 2 章: 行の高さ 40px
const ROW_HEIGHT = "40px";

// 項目の区切り(装飾。読み上げない)
const SEPARATOR = " ・ ";

const styles = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    backgroundColor: bg.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    padding: { default: space.lg, [NARROW]: space.md },
    fontFamily: font.family,
    color: text.default,
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    columnGap: space.sm,
    paddingBottom: space.sm,
  },
  title: {
    margin: 0,
    fontSize: font.body,
    fontWeight: font.weightBold,
    color: text.default,
  },
  note: { fontSize: font.caption, color: text.muted },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.inset,
    minHeight: ROW_HEIGHT,
    minWidth: 0,
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
    fontSize: font.body,
    color: text.default,
    textDecoration: "none",
  },
  rowLink: { cursor: "pointer", outline: "none" },
  rowHover: { backgroundColor: bg.hover },
  focusRing: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: `calc(-1 * ${stroke.focus})`,
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.xs,
    paddingBlock: space.lg,
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
    textAlign: "center",
    color: text.muted,
  },
  emptyText: { margin: 0, fontSize: font.body, color: text.muted },
  emptyHint: { margin: 0, fontSize: font.caption, color: text.muted },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    paddingTop: space.sm,
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
    fontSize: font.caption,
    color: text.muted,
  },
  loadingRow: {
    display: "flex",
    alignItems: "center",
    minHeight: ROW_HEIGHT,
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
  },
  typeLinks: {
    display: "inline-flex",
    flexWrap: "wrap",
    alignItems: "center",
    fontSize: font.caption,
    color: text.muted,
  },
  separator: { whiteSpace: "pre" },
  inlineLink: {
    borderRadius: radius.small,
    color: text.default,
    textDecoration: { default: "none", ":hover": "underline" },
    cursor: "pointer",
    outline: "none",
  },
  inlineFocus: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  titleLink: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    borderRadius: radius.small,
    color: text.default,
    textDecoration: { default: "none", ":hover": "underline" },
    cursor: "pointer",
    outline: "none",
  },
});

export function HomeCard({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.header)}>
        <h2 id={titleId} {...stylex.props(styles.title)}>
          {title}
        </h2>
        {note === undefined ? null : <span {...stylex.props(styles.note)}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

// href があれば行全体が RAC Link(裁定 B10)。無ければ div(中に個別のリンクを置く行)
export function CardRow({
  href,
  children,
  "aria-label": ariaLabel,
}: {
  href?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  if (href === undefined) {
    return (
      <div aria-label={ariaLabel} {...stylex.props(styles.row)}>
        {children}
      </div>
    );
  }
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={stylexRenderProps<LinkRenderProps>((state) => [
        styles.row,
        styles.rowLink,
        state.isHovered && styles.rowHover,
        state.isFocusVisible && styles.focusRing,
      ])}
    >
      {children}
    </Link>
  );
}

/** 行の中のタイトルリンク(1 行に収め、はみ出しは省略記号) */
export function RowTitleLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={stylexRenderProps<LinkRenderProps>((state) => [
        styles.titleLink,
        state.isFocusVisible && styles.inlineFocus,
      ])}
    >
      {children}
    </Link>
  );
}

// 裁定 B8: 空のカードは上罫線の下に中央寄せで案内する
export function CardEmpty({
  icon: Icon,
  text: message,
  hint,
}: {
  icon: LucideIcon;
  text: string;
  hint?: string;
}) {
  return (
    <div {...stylex.props(styles.empty)}>
      <Icon aria-hidden="true" size={ICON_SIZE.nav} strokeWidth={ICON_STROKE.large} />
      <p {...stylex.props(styles.emptyText)}>{message}</p>
      {hint === undefined ? null : <p {...stylex.props(styles.emptyHint)}>{hint}</p>}
    </div>
  );
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.footer)}>{children}</div>;
}

export function CardLoadingRows({ count }: { count: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} {...stylex.props(styles.loadingRow)}>
          <Skeleton height={14} width="60%" />
        </div>
      ))}
    </div>
  );
}

function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={stylexRenderProps<LinkRenderProps>((state) => [
        styles.inlineLink,
        state.isFocusVisible && styles.inlineFocus,
      ])}
    >
      {children}
    </Link>
  );
}

// 裁定 B1: 「お知らせ 2 ・ ブログ 1」。各項目がその型の一覧へのリンク
export function TypeLinks({
  items,
  hrefOf,
}: {
  items: TypeCount[];
  hrefOf: (type: HomeType) => string;
}) {
  return (
    <span {...stylex.props(styles.typeLinks)}>
      {items.map((item, index) => (
        <Fragment key={item.type.key}>
          {index === 0 ? null : (
            <span aria-hidden="true" {...stylex.props(styles.separator)}>
              {SEPARATOR}
            </span>
          )}
          <InlineLink href={hrefOf(item.type)}>
            {HOME_LABELS.typeCount(item.type.name, item.count)}
          </InlineLink>
        </Fragment>
      ))}
    </span>
  );
}

// 裁定 B1: 型が 1 つなら label がそのままリンク、複数なら label は文字にして型ごとのリンクを添える
export function SummaryLink({
  summary,
  hrefOf,
  label,
}: {
  summary: StatusSummary;
  hrefOf: (type: HomeType) => string;
  label: string;
}) {
  const [only, ...rest] = summary.byType;
  if (only !== undefined && rest.length === 0) {
    return <InlineLink href={hrefOf(only.type)}>{label}</InlineLink>;
  }
  return (
    <span {...stylex.props(styles.typeLinks)}>
      <span>{label}</span>
      {summary.byType.length === 0 ? null : (
        <>
          <span aria-hidden="true" {...stylex.props(styles.separator)}>
            {SEPARATOR}
          </span>
          <TypeLinks items={summary.byType} hrefOf={hrefOf} />
        </>
      )}
    </span>
  );
}
