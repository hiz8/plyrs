import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button, TextField } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { ACCOUNT_LABELS } from "../../lib/labels";

const NARROW = "@media (max-width: 959px)";
const MIN_LENGTH = 12;

const styles = stylex.create({
  form: { display: "flex", flexDirection: "column", gap: space.md },
  grid: {
    display: "grid",
    gridTemplateColumns: { default: "repeat(2, minmax(0, 1fr))", [NARROW]: "minmax(0, 1fr)" },
    gap: space.lg,
  },
  footer: { display: "flex", alignItems: "center", gap: space.md },
  note: { flex: 1, fontSize: font.caption, color: text.muted },
});

// API の結果(wrong_password / same_password)。親が持つ
export interface PasswordFieldErrors {
  current?: string;
  next?: string;
}

export interface PasswordFormProps {
  onSubmit: (currentPassword: string, newPassword: string) => void;
  isPending: boolean;
  fieldErrors: PasswordFieldErrors;
  // 成功のたびに親が増やし、入力を空に戻す
  resetKey: number;
  // 欄を編集したら、その欄に出ていた API の誤りを親が消す
  onClearFieldError?: (field: keyof PasswordFieldErrors) => void;
}

export function PasswordForm({ resetKey, ...props }: PasswordFormProps) {
  return <PasswordFormInner key={resetKey} {...props} />;
}

function PasswordFormInner({
  onSubmit,
  isPending,
  fieldErrors,
  onClearFieldError,
}: Omit<PasswordFormProps, "resetKey">) {
  const labels = ACCOUNT_LABELS.password;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<{ next?: string; confirm?: string }>({});
  const incomplete = current === "" || next === "" || confirm === "";
  const nextError = localError.next ?? fieldErrors.next;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (incomplete || isPending) {
          return;
        }
        if (next.length < MIN_LENGTH) {
          setLocalError({ next: labels.tooShort });
          return;
        }
        if (next !== confirm) {
          setLocalError({ confirm: labels.mismatch });
          return;
        }
        setLocalError({});
        onSubmit(current, next);
      }}
      {...stylex.props(styles.form)}
    >
      <div {...stylex.props(styles.grid)}>
        <TextField
          type="password"
          autoComplete="current-password"
          label={labels.current}
          value={current}
          onChange={(value) => {
            setCurrent(value);
            onClearFieldError?.("current");
          }}
          isInvalid={fieldErrors.current !== undefined}
          errorMessage={fieldErrors.current ?? ""}
        />
        <div aria-hidden="true" />
        <TextField
          type="password"
          autoComplete="new-password"
          label={labels.next}
          description={labels.nextHelp}
          value={next}
          onChange={(value) => {
            setNext(value);
            setLocalError((e) => ({ ...e, next: undefined }));
            onClearFieldError?.("next");
          }}
          isInvalid={nextError !== undefined}
          errorMessage={nextError ?? ""}
        />
        <TextField
          type="password"
          autoComplete="new-password"
          label={labels.confirm}
          value={confirm}
          onChange={(value) => {
            setConfirm(value);
            setLocalError((e) => ({ ...e, confirm: undefined }));
          }}
          isInvalid={localError.confirm !== undefined}
          errorMessage={localError.confirm ?? ""}
        />
      </div>
      <div {...stylex.props(styles.footer)}>
        <span {...stylex.props(styles.note)}>{labels.note}</span>
        <Button type="submit" variant="primary" isDisabled={incomplete || isPending}>
          {labels.submit}
        </Button>
      </div>
    </form>
  );
}
