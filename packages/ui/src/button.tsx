import * as stylex from "@stylexjs/stylex";
import type { LucideIcon } from "lucide-react";
import { createContext, useContext, useId, type ReactNode, type Ref } from "react";
import {
  Button as RacButton,
  VisuallyHidden,
  type ButtonProps as RacButtonProps,
  type ButtonRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import {
  accent,
  bg,
  border,
  focus,
  font,
  motion,
  radius,
  size,
  space,
  status,
  stroke,
  text,
} from "./semantic.stylex";
import { Tooltip } from "./tooltip";

// D1 ボード 3a: 塗り / 枠線 / 危険 / テキストリンク(+ 危険色)と、アイコンのみのゴースト(IconButton)。
// 角丸はすべて radius.button(案 R)。危険の押下はキャンバスの inset 影を採らず dangerHover だけにした
// (h-design-tokens.md 3.1 の用途「危険ボタンのホバー・押下」)
const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    height: size.control,
    paddingInline: space.md,
    fontFamily: font.family,
    fontSize: font.body,
    fontWeight: font.weightMedium,
    lineHeight: 1,
    whiteSpace: "nowrap",
    textDecoration: "none",
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: radius.button,
    cursor: "pointer",
    outline: "none",
    transitionProperty: "background-color, border-color, color",
    transitionDuration: motion.fast,
  },
  sm: { height: size.controlSm, paddingInline: space.inset, fontSize: font.caption },
  primary: { backgroundColor: accent.default, color: text.onAccent },
  primaryHovered: { backgroundColor: accent.hover },
  primaryPressed: { backgroundColor: accent.active },
  secondary: { backgroundColor: bg.canvas, color: text.default, borderColor: border.default },
  secondaryHovered: { backgroundColor: bg.hover, borderColor: border.hover },
  secondaryPressed: { backgroundColor: bg.pressed, borderColor: border.hover },
  // 種類のカードなど縦に積む選択肢(E33)。選択中は aria-pressed で accent の面と枠
  card: {
    height: "auto",
    width: "100%",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    gap: space.xs,
    padding: space.inset,
    textAlign: "start",
    whiteSpace: "normal",
    backgroundColor: bg.canvas,
    color: text.default,
    borderColor: border.default,
    borderRadius: radius.item,
  },
  cardSelected: { backgroundColor: accent.surface, borderColor: accent.default },
  danger: { backgroundColor: status.danger, color: text.onAccent },
  dangerHovered: { backgroundColor: status.dangerHover },
  dangerPressed: { backgroundColor: status.dangerHover },
  link: {
    height: "auto",
    paddingBlock: space.xxs,
    paddingInline: space.xs,
    borderRadius: radius.small,
    backgroundColor: "transparent",
    color: accent.default,
  },
  linkHovered: { color: accent.hover, textDecoration: "underline" },
  linkPressed: { color: accent.active, textDecoration: "underline" },
  dangerLink: {
    height: "auto",
    paddingBlock: space.xxs,
    paddingInline: space.xs,
    borderRadius: radius.small,
    backgroundColor: "transparent",
    color: status.danger,
  },
  dangerLinkHovered: { color: status.dangerHover, textDecoration: "underline" },
  ghost: { backgroundColor: "transparent", color: text.muted, paddingInline: 0 },
  ghostHovered: { backgroundColor: bg.hover, color: text.default },
  ghostPressed: { backgroundColor: bg.pressed, color: text.default },
  iconMd: { width: size.control },
  iconSm: { width: size.controlSm, height: size.controlSm },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
  disabledCursor: { cursor: "not-allowed" },
  reasonLine: { display: "block" },
});

/**
 * @internal 親が無効の見た目(opacity)を既に持つとき、中のボタンの opacity を重ねないために使う
 * (drop-zone.tsx)。操作の無効化は isDisabled のまま行う
 */
export const DisabledAppearanceInheritedContext = createContext(false);

interface DisabledReasonResult {
  /** RAC の Button へ渡す props(押下の処理を外し、isDisabled を使わない) */
  racProps: RacButtonProps;
  /** disabledReason があり、無効として振る舞うか */
  isInert: boolean;
  /** aria-describedby で結ぶ、視覚的に隠した理由の文言 */
  reason: ReactNode;
}

// h-common-surface.md 7 章: 無効にして理由を添える。RAC の isDisabled はフォーカスを受けなくなるため使わず、
// aria-disabled + 押下の処理を外す形にし、理由をツールチップと aria-describedby で伝える
function useDisabledReason(
  props: RacButtonProps,
  disabledReason: string | undefined,
): DisabledReasonResult {
  const reasonId = useId();
  if (disabledReason === undefined) return { racProps: props, isInert: false, reason: null };
  const {
    onPress: _onPress,
    onPressStart: _onPressStart,
    onPressEnd: _onPressEnd,
    onPressChange: _onPressChange,
    onPressUp: _onPressUp,
    isDisabled: _isDisabled,
    type: _type,
    ...rest
  } = props;
  const describedBy = [props["aria-describedby"], reasonId].filter(Boolean).join(" ");
  return {
    racProps: {
      ...rest,
      // submit / reset でもフォームへ作用させない
      type: "button",
      "aria-disabled": "true",
      "aria-describedby": describedBy,
    },
    isInert: true,
    reason: (
      <VisuallyHidden elementType="span" id={reasonId}>
        {disabledReason}
      </VisuallyHidden>
    ),
  };
}

export type ButtonVariant = "primary" | "secondary" | "card" | "danger" | "link" | "dangerLink";
export type ButtonSize = "md" | "sm";

const VARIANT_STYLES = {
  primary: [styles.primary, styles.primaryHovered, styles.primaryPressed],
  secondary: [styles.secondary, styles.secondaryHovered, styles.secondaryPressed],
  card: [styles.card, styles.secondaryHovered, styles.secondaryPressed],
  danger: [styles.danger, styles.dangerHovered, styles.dangerPressed],
  link: [styles.link, styles.linkHovered, styles.linkPressed],
  dangerLink: [styles.dangerLink, styles.dangerLinkHovered, styles.dangerLinkHovered],
} as const;

export interface ButtonProps extends Omit<RacButtonProps, "className" | "style" | "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 文字の左に置く Lucide のアイコン(装飾。読み上げない) */
  icon?: LucideIcon;
  children?: ReactNode;
  /** フォーカスの戻し先などに使うボタン要素への参照 */
  ref?: Ref<HTMLButtonElement>;
  /**
   * 押せない理由。指定すると、フォーカスを受けたまま無効として振る舞い(aria-disabled)、
   * 理由をツールチップと aria-describedby で伝える。isDisabled より優先する
   */
  disabledReason?: string;
}

export function Button({
  variant = "primary",
  size: buttonSize = "md",
  icon: Icon,
  children,
  disabledReason,
  ref,
  ...props
}: ButtonProps) {
  const [normal, hovered, pressed] = VARIANT_STYLES[variant];
  const inheritsDisabled = useContext(DisabledAppearanceInheritedContext);
  const { racProps, isInert, reason } = useDisabledReason(props, disabledReason);
  const button = (
    <RacButton
      {...racProps}
      ref={ref}
      className={stylexRenderProps<ButtonRenderProps>((state) => [
        styles.base,
        buttonSize === "sm" && variant !== "card" && styles.sm,
        normal,
        !isInert && state.isHovered && hovered,
        !isInert && state.isPressed && pressed,
        variant === "card" && props["aria-pressed"] === true && styles.cardSelected,
        state.isFocusVisible && styles.focusVisible,
        (isInert || state.isDisabled) &&
          (inheritsDisabled ? styles.disabledCursor : styles.disabled),
      ])}
    >
      {Icon !== undefined && <Icon size={ICON_SIZE.inline} aria-hidden="true" />}
      {children}
    </RacButton>
  );
  // 理由の文言はボタンの外に置く(中に置くと名前に混ざる)
  return disabledReason === undefined ? (
    button
  ) : (
    <Tooltip content={disabledReason}>
      <>
        {button}
        {reason}
      </>
    </Tooltip>
  );
}

export interface IconButtonProps extends Omit<
  RacButtonProps,
  "className" | "style" | "children" | "aria-label"
> {
  icon: LucideIcon;
  /** aria-label とツールチップの文言(h-common-surface.md 12 章: アイコンのみのボタンは必須) */
  label: string;
  size?: ButtonSize;
  /** Button の disabledReason と同じ。名前は label のまま、理由を説明として結ぶ */
  disabledReason?: string;
}

export function IconButton({
  icon: Icon,
  label,
  size: buttonSize = "md",
  disabledReason,
  ...props
}: IconButtonProps) {
  const { racProps, isInert, reason } = useDisabledReason(props, disabledReason);
  // 理由があるときはツールチップにラベルと理由を 2 行で出す。読み上げは名前(aria-label)と
  // 説明(aria-describedby)で両方が伝わり、見える側もラベルを失わない
  const content =
    disabledReason === undefined ? (
      label
    ) : (
      <>
        <span {...stylex.props(styles.reasonLine)}>{label}</span>
        <span {...stylex.props(styles.reasonLine)}>{disabledReason}</span>
      </>
    );
  return (
    <Tooltip content={content}>
      <>
        <RacButton
          {...racProps}
          aria-label={label}
          className={stylexRenderProps<ButtonRenderProps>((state) => [
            styles.base,
            styles.ghost,
            buttonSize === "sm" ? styles.iconSm : styles.iconMd,
            !isInert && state.isHovered && styles.ghostHovered,
            !isInert && state.isPressed && styles.ghostPressed,
            state.isFocusVisible && styles.focusVisible,
            (isInert || state.isDisabled) && styles.disabled,
          ])}
        >
          <Icon size={ICON_SIZE.inline} aria-hidden="true" />
        </RacButton>
        {reason}
      </>
    </Tooltip>
  );
}
