import * as stylex from "@stylexjs/stylex";
import { ChevronRight } from "lucide-react";
import {
  Breadcrumb,
  Breadcrumbs as RacBreadcrumbs,
  Link,
  type LinkRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import { focus, font, radius, space, stroke, text } from "./semantic.stylex";

// D1 ボード 3c / 4。キャンバスの 13px は尺度の 14px(font.body)に寄せた
const styles = stylex.create({
  list: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.sm,
    margin: 0,
    padding: 0,
    listStyle: "none",
    fontFamily: font.family,
    fontSize: font.body,
  },
  item: { display: "inline-flex", alignItems: "center", gap: space.sm, minWidth: 0 },
  link: {
    color: text.muted,
    textDecoration: "none",
    borderRadius: radius.small,
    outline: "none",
    cursor: "pointer",
  },
  linkHovered: { color: text.default },
  current: {
    display: "inline-block",
    // 長い末尾の項目だけを省略記号で切る(D1 ボード 3c)
    maxWidth: "200px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: text.default,
    fontWeight: font.weightMedium,
    cursor: "default",
  },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  separator: { display: "inline-flex", color: text.muted, flexShrink: 0 },
});

export interface BreadcrumbItem {
  id: string;
  label: string;
  /** 末尾(現在地)は省略する */
  href?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="パンくず">
      <RacBreadcrumbs items={items} className={stylex.props(styles.list).className ?? ""}>
        {(item) => (
          <Breadcrumb id={item.id} className={stylex.props(styles.item).className ?? ""}>
            {({ isCurrent }) => (
              <>
                <Link
                  {...(item.href === undefined ? {} : { href: item.href })}
                  className={stylexRenderProps<LinkRenderProps>((state) => [
                    styles.link,
                    !isCurrent && state.isHovered && styles.linkHovered,
                    isCurrent && styles.current,
                    state.isFocusVisible && styles.focusVisible,
                  ])}
                >
                  {isCurrent ? <span title={item.label}>{item.label}</span> : item.label}
                </Link>
                {!isCurrent && (
                  <span {...stylex.props(styles.separator)}>
                    <ChevronRight size={ICON_SIZE.inline} aria-hidden="true" />
                  </span>
                )}
              </>
            )}
          </Breadcrumb>
        )}
      </RacBreadcrumbs>
    </nav>
  );
}
