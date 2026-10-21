import * as stylex from "@stylexjs/stylex";
import { X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Dialog, Heading } from "react-aria-components";
import { IconButton } from "./button";
import { bg, border, elevation, font, layer, radius, space, stroke, text } from "./semantic.stylex";

const NARROW = "@media (max-width: 959px)";

// E2 / D3 T2。モーダルにしない右パネル(背面は操作できる)。狭い画面は全面のシート
const styles = stylex.create({
  panel: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    // 幅は styles.width(px)(部品固有。E 5.2 / D3 T2)
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
  width: (px: number) => ({
    width: { default: `${px}px`, [NARROW]: "auto" },
  }),
  // C2。狭い画面では下から出る高さ 520px の面(全面にしない)
  sheet: {
    top: { default: 0, [NARROW]: "auto" },
    height: { default: null, [NARROW]: "520px" },
    maxHeight: { default: null, [NARROW]: "100%" },
    borderLeftWidth: { default: stroke.default, [NARROW]: 0 },
    borderTopWidth: { default: 0, [NARROW]: stroke.default },
    borderTopStyle: "solid",
    borderTopColor: border.default,
    borderStartStartRadius: { default: null, [NARROW]: radius.container },
    borderStartEndRadius: { default: null, [NARROW]: radius.container },
  },
  handle: {
    display: { default: "none", [NARROW]: "block" },
    alignSelf: "center",
    flexShrink: 0,
    width: "36px",
    height: "4px",
    marginBlockStart: space.xs,
    borderRadius: radius.full,
    backgroundColor: border.hover,
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
  /** 幅 px。既定 420(E 5.2)。メディアの詳細は 360(F 4 章) */
  width?: number;
  /** 狭い画面(959px 以下)の形。full = 全面のシート(既定、E2)、sheet = 下から出る高さ 520px の面(C2) */
  narrowLayout?: "full" | "sheet";
}

export function SidePanel({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  returnFocusTo,
  width = 420,
  narrowLayout = "full",
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
    <div
      {...stylex.props(styles.panel, styles.width(width), narrowLayout === "sheet" && styles.sheet)}
      onKeyDown={onKeyDown}
    >
      <Dialog className={stylex.props(styles.dialog).className ?? ""}>
        {narrowLayout === "sheet" && <div aria-hidden="true" {...stylex.props(styles.handle)} />}
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
