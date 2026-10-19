import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { bg, border, elevation, layer, stroke } from "./semantic.stylex";

// 狭い画面のサイドバー。ModalDialog と同じ RAC の ModalOverlay / Modal / Dialog で、
// フォーカスの閉じ込めと復帰は RAC に任せる。暗幕は上部バーの下だけを覆う(offsetTop)
const styles = stylex.create({
  overlay: {
    position: "fixed",
    insetInline: 0,
    bottom: 0,
    zIndex: layer.modal,
    backgroundColor: bg.overlay,
  },
  // 上端は呼び出し側の上部バーの高さに合わせる動的な値
  offset: (top: number) => ({ top }),
  modal: {
    position: "absolute",
    insetBlock: 0,
    insetInlineStart: 0,
    // 部品固有の幅
    width: "240px",
    maxWidth: "100%",
    overflowY: "auto",
    backgroundColor: bg.surface,
    borderInlineEndWidth: stroke.default,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: border.default,
    boxShadow: elevation.modal,
    outline: "none",
  },
  dialog: { height: "100%", outline: "none" },
});

export interface DrawerProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** ダイアログの名前(スクリーンリーダー向け) */
  label: string;
  children: ReactNode;
  /** 暗幕の上端(上部バーの高さ)。既定 0 */
  offsetTop?: number;
}

export function Drawer({ isOpen, onOpenChange, label, children, offsetTop = 0 }: DrawerProps) {
  // 動的スタイルは top を inline の CSS 変数で渡すので、className だけでなく style も渡す
  const overlay = stylex.props(styles.overlay, styles.offset(offsetTop));
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className={overlay.className ?? ""}
      style={overlay.style ?? {}}
    >
      <Modal className={stylex.props(styles.modal).className ?? ""}>
        <Dialog aria-label={label} className={stylex.props(styles.dialog).className ?? ""}>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
