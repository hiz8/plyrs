import * as stylex from "@stylexjs/stylex";
import { X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Dialog, Heading } from "react-aria-components";
import { IconButton } from "./button";
import { bg, border, elevation, font, layer, space, stroke, text } from "./semantic.stylex";

const NARROW = "@media (max-width: 959px)";

// E2 / D3 T2。モーダルにしない右パネル(背面は操作できる)。狭い画面は全面のシート
const styles = stylex.create({
  panel: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    // 部品固有の幅(E 5.2 / D3 T2)
    width: { default: "420px", [NARROW]: "auto" },
    insetInline: { default: null, [NARROW]: 0 },
    zIndex: layer.dropdown,
    display: "flex",
    flexDirection: "column",
    backgroundColor: bg.raised,
    borderLeftWidth: stroke.default,
    borderLeftStyle: "solid",
    borderLeftColor: border.default,
    boxShadow: elevation.modal,
    fontFamily: font.family,
  },
  dialog: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    outline: "none",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.sm,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  headings: { flex: 1, minWidth: 0 },
  title: {
    margin: 0,
    fontSize: font.label,
    fontWeight: font.weightBold,
    lineHeight: font.lineHeightTight,
    color: text.default,
  },
  subtitle: {
    margin: 0,
    fontSize: font.caption,
    lineHeight: font.lineHeightNormal,
    color: text.muted,
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    padding: space.lg,
  },
  footer: {
    paddingBlock: space.sm,
    paddingInline: space.lg,
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
  },
});

export interface SidePanelProps {
  isOpen: boolean;
  /** 閉じるボタンと Esc */
  onClose: () => void;
  title: string;
  /** 題の下の補足(「種類: テキスト(1 行)」など) */
  subtitle?: string;
  children: ReactNode;
  /** 下部。並べ方は呼び出し側 */
  footer?: ReactNode;
  /** 閉じたときにフォーカスを戻す先(パネルを開いたボタン) */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

export function SidePanel({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  returnFocusTo,
}: SidePanelProps) {
  // isOpen が true → false に変わった一度だけフォーカスを戻す
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (wasOpen.current && !isOpen) returnFocusTo?.current?.focus();
    wasOpen.current = isOpen;
  }, [isOpen, returnFocusTo]);

  if (!isOpen) return null;

  // モーダルではないので overlay が Esc を処理しない。入力欄の中でも閉じる(IME の変換中は閉じない)。
  // 名前の無い complementary ランドマークを避けるため aside ではなく div にする
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) onClose();
  };

  return (
    <div {...stylex.props(styles.panel)} onKeyDown={onKeyDown}>
      <Dialog className={stylex.props(styles.dialog).className ?? ""}>
        <div {...stylex.props(styles.header)}>
          <div {...stylex.props(styles.headings)}>
            <Heading slot="title" {...stylex.props(styles.title)}>
              {title}
            </Heading>
            {subtitle !== undefined && <p {...stylex.props(styles.subtitle)}>{subtitle}</p>}
          </div>
          <IconButton icon={X} label="閉じる" size="sm" onPress={onClose} />
        </div>
        <div {...stylex.props(styles.body)}>{children}</div>
        {footer !== undefined && <div {...stylex.props(styles.footer)}>{footer}</div>}
      </Dialog>
    </div>
  );
}
