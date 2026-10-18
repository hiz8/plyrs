import * as stylex from "@stylexjs/stylex";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button, IconButton } from "./button";
import { bg, border, elevation, font, layer, radius, space, stroke, text } from "./semantic.stylex";

// D1 ボード 3c。本体は浮いた面(bg.raised + 枠線 + elevation.modal)。題は設計書どおり 20px
const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: layer.modal,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: space.md,
    backgroundColor: bg.overlay,
  },
  modal: {
    // 部品固有の幅(D1 ボード 3c)
    width: "440px",
    maxWidth: "100%",
    maxHeight: "100%",
    overflowY: "auto",
    backgroundColor: bg.raised,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    boxShadow: elevation.modal,
    outline: "none",
  },
  dialog: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    padding: space.lg,
    fontFamily: font.family,
    outline: "none",
  },
  header: { display: "flex", alignItems: "flex-start", gap: space.sm },
  title: {
    flex: 1,
    margin: 0,
    fontSize: font.sectionTitle,
    fontWeight: font.weightBold,
    lineHeight: font.lineHeightTight,
    color: text.default,
  },
  body: { fontSize: font.body, lineHeight: font.lineHeightNormal, color: text.muted },
  footer: { display: "flex", justifyContent: "flex-end", gap: space.sm },
});

export interface ModalDialogProps {
  title: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  children: ReactNode;
  /** 右寄せのボタン。実行ボタンを右端に置く */
  footer?: ReactNode;
  role?: "dialog" | "alertdialog";
  /** 暗幕のクリックで閉じるか */
  isDismissable?: boolean;
  showCloseButton?: boolean;
}

export function ModalDialog({
  title,
  isOpen,
  onOpenChange,
  children,
  footer,
  role = "dialog",
  isDismissable = true,
  showCloseButton = true,
}: ModalDialogProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={isDismissable}
      className={stylex.props(styles.overlay).className ?? ""}
    >
      <Modal className={stylex.props(styles.modal).className ?? ""}>
        <Dialog role={role} className={stylex.props(styles.dialog).className ?? ""}>
          <div {...stylex.props(styles.header)}>
            <Heading slot="title" {...stylex.props(styles.title)}>
              {title}
            </Heading>
            {showCloseButton && <IconButton icon={X} label="閉じる" size="sm" slot="close" />}
          </div>
          <div {...stylex.props(styles.body)}>{children}</div>
          {footer !== undefined && <div {...stylex.props(styles.footer)}>{footer}</div>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export interface ConfirmDialogProps {
  title: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** 何が起きるかの説明 */
  children: ReactNode;
  /** 実行する操作名(「OK」にしない。h-common-surface.md 4.2) */
  confirmLabel: string;
  cancelLabel?: string;
  /** 8 章: 元に戻せない・公開中の内容に影響する操作は danger */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  isPending?: boolean;
}

export function ConfirmDialog({
  title,
  isOpen,
  onOpenChange,
  children,
  confirmLabel,
  cancelLabel = "キャンセル",
  tone = "danger",
  onConfirm,
  isPending,
}: ConfirmDialogProps) {
  return (
    <ModalDialog
      title={title}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      role={tone === "danger" ? "alertdialog" : "dialog"}
      isDismissable={false}
      showCloseButton={false}
      footer={
        <>
          <Button variant="secondary" slot="close">
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            autoFocus
            isDisabled={isPending ?? false}
            onPress={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </ModalDialog>
  );
}
