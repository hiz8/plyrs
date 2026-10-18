import * as stylex from "@stylexjs/stylex";
import { CircleAlert, CircleCheck, X, type LucideIcon } from "lucide-react";
import {
  Text,
  UNSTABLE_Toast as RacToast,
  UNSTABLE_ToastContent as RacToastContent,
  UNSTABLE_ToastQueue as RacToastQueue,
  UNSTABLE_ToastRegion as RacToastRegion,
  type ToastRenderProps,
} from "react-aria-components";
import { Button, IconButton } from "./button";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import {
  bg,
  border,
  elevation,
  focus,
  font,
  layer,
  radius,
  space,
  status,
  stroke,
  text,
} from "./semantic.stylex";

// h-common-surface.md 3 章(2026-10-18): RAC 1.21.1 ではトーストが UNSTABLE_ としてだけ提供される。
// UNSTABLE_ の import はこのファイルに閉じ込め、外へは Toaster と ToastRegion だけを出す。
// 地は bg.raised(設計書 3.1)とし、成功 / エラーはアイコンの色で示す

export type ToastTone = "success" | "danger";

export interface ToastAction {
  label: string;
  onAction: () => void;
  icon?: LucideIcon;
}

interface ToastValue {
  tone: ToastTone;
  title: string;
  action?: ToastAction;
}

// 11 章: 成功は 5 秒で消え、エラーは閉じるまで残す
const SUCCESS_TIMEOUT_MS = 5_000;

export interface Toaster {
  /** @internal ToastRegion が使う */
  readonly queue: RacToastQueue<ToastValue>;
  success(title: string): string;
  error(title: string, action?: ToastAction): string;
  close(key: string): void;
}

export function createToaster(): Toaster {
  const queue = new RacToastQueue<ToastValue>({ maxVisibleToasts: 3 });
  return {
    queue,
    success: (title) => queue.add({ tone: "success", title }, { timeout: SUCCESS_TIMEOUT_MS }),
    error: (title, action) =>
      queue.add(
        action === undefined ? { tone: "danger", title } : { tone: "danger", title, action },
      ),
    close: (key) => queue.close(key),
  };
}

/** アプリ全体で 1 つのトースト。ToastRegion はシェル(V2)が 1 か所に置く */
export const toaster = createToaster();

const styles = stylex.create({
  region: {
    position: "fixed",
    insetInlineEnd: space.lg,
    insetBlockEnd: space.lg,
    zIndex: layer.toast,
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    // 部品固有の幅(D1 ボード 3c)
    width: "400px",
    maxWidth: `calc(100vw - 2 * ${space.md})`,
    outline: "none",
  },
  toast: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.inset,
    padding: space.inset,
    fontFamily: font.family,
    fontSize: font.body,
    lineHeight: font.lineHeightNormal,
    color: text.default,
    backgroundColor: bg.raised,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    boxShadow: elevation.modal,
    outline: "none",
  },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  // 28px の閉じるボタンと 1 行目の高さを揃える
  icon: { display: "inline-flex", flexShrink: 0, paddingBlock: space.xs },
  successIcon: { color: status.success },
  dangerIcon: { color: status.danger },
  content: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.sm,
    paddingBlock: space.xxs,
  },
});

export function ToastRegion({ toaster: target = toaster }: { toaster?: Toaster }) {
  return (
    <RacToastRegion
      queue={target.queue}
      aria-label="通知"
      className={stylex.props(styles.region).className ?? ""}
    >
      {({ toast }) => {
        const { tone, title, action } = toast.content;
        const Icon = tone === "success" ? CircleCheck : CircleAlert;
        return (
          <RacToast
            toast={toast}
            className={stylexRenderProps<ToastRenderProps<ToastValue>>((state) => [
              styles.toast,
              state.isFocusVisible && styles.focusVisible,
            ])}
          >
            <span
              {...stylex.props(
                styles.icon,
                tone === "success" ? styles.successIcon : styles.dangerIcon,
              )}
            >
              <Icon size={ICON_SIZE.inline} aria-hidden="true" />
            </span>
            {/* RAC は role="alert" を既定にする。成功は status で控えめに読み上げる(11 章) */}
            <RacToastContent
              role={tone === "danger" ? "alert" : "status"}
              {...stylex.props(styles.content)}
            >
              <Text slot="title">{title}</Text>
              {action !== undefined && (
                <Button
                  variant="secondary"
                  size="sm"
                  {...(action.icon === undefined ? {} : { icon: action.icon })}
                  onPress={() => {
                    action.onAction();
                    target.close(toast.key);
                  }}
                >
                  {action.label}
                </Button>
              )}
            </RacToastContent>
            <IconButton icon={X} label="閉じる" size="sm" slot="close" />
          </RacToast>
        );
      }}
    </RacToastRegion>
  );
}
