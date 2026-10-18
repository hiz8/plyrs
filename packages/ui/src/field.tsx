import * as stylex from "@stylexjs/stylex";
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { FieldError, Label, Text, type ValidationResult } from "react-aria-components";
import { ICON_SIZE } from "./icon";
import { font, space, status, text } from "./semantic.stylex";

// D1 ボード 3b: ラベル → 入力欄 → 説明文またはエラー の縦並び(gap はキャンバスの 6px を 8px に寄せた)
const styles = stylex.create({
  field: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    fontFamily: font.family,
  },
  // 2026-10-18 裁定: ラベルは 14px / 500
  labelRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
  },
  label: {
    fontSize: font.body,
    fontWeight: font.weightMedium,
    color: text.default,
  },
  required: {
    fontSize: font.caption,
    fontWeight: font.weightMedium,
    color: status.danger,
  },
  description: { fontSize: font.caption, color: text.muted },
  error: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    fontSize: font.caption,
    color: status.danger,
  },
});

export function fieldClassName(): string {
  return stylex.props(styles.field).className ?? "";
}

export function FieldLabel({
  children,
  isRequired,
  elementType,
}: {
  children: ReactNode;
  isRequired?: boolean | undefined;
  elementType?: string;
}) {
  // 札は <label> の外に置く。label の中だと getByLabelText などの名前照合に「必須」が混ざる
  return (
    <span {...stylex.props(styles.labelRow)}>
      <Label elementType={elementType} className={stylex.props(styles.label).className ?? ""}>
        {children}
      </Label>
      {/* 必須は入力欄の required / aria-required で伝わる。札は読み上げない */}
      {isRequired === true && (
        <span aria-hidden="true" {...stylex.props(styles.required)}>
          必須
        </span>
      )}
    </span>
  );
}

export function FieldDescription({ children }: { children: ReactNode }) {
  return (
    <Text slot="description" className={stylex.props(styles.description).className ?? ""}>
      {children}
    </Text>
  );
}

function ErrorIcon() {
  return <CircleAlert size={ICON_SIZE.inline} aria-hidden="true" />;
}

/** RAC のフィールド(TextField など)の中で使う。invalid のときだけ表示される */
export function FieldErrorMessage({
  errorMessage,
}: {
  errorMessage?: string | ((validation: ValidationResult) => string) | undefined;
}) {
  return (
    <FieldError className={stylex.props(styles.error).className ?? ""}>
      {(validation) => {
        const message =
          typeof errorMessage === "function"
            ? errorMessage(validation)
            : (errorMessage ?? validation.validationErrors.join(" "));
        return (
          <>
            <ErrorIcon />
            {message}
          </>
        );
      }}
    </FieldError>
  );
}

/** RAC のフィールド文脈の外(CheckboxGroup・RichTextEditor)や Select の errorMessage スロットで使う */
export function FieldErrorText({
  children,
  id,
  slot,
}: {
  children: ReactNode;
  id?: string;
  slot?: string;
}) {
  return (
    <Text slot={slot} id={id} className={stylex.props(styles.error).className ?? ""}>
      <ErrorIcon />
      {children}
    </Text>
  );
}
