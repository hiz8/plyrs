import * as stylex from "@stylexjs/stylex";
import { Copy, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button, Checkbox, ModalDialog, Select, TextField } from "@plyrs/ui";
import { border, font, radius, space, status, stroke, text } from "@plyrs/ui/semantic.stylex";
import type { IssueTokenInput, IssuedToken } from "~/lib/admin-api";
import { copyText } from "~/lib/clipboard";
import { DIALOGS } from "~/lib/labels";
import { TOKEN_LABELS } from "../-lib/settings-labels";
import type { Role } from "~/lib/api-contracts";
import {
  DEFAULT_SCOPES,
  defaultExpiryFor,
  expiryOptionsFor,
  isReadOnlyScopes,
  lacksProposeFallback,
  PAT_SCOPES,
  scopeOptionsFor,
  type PatScope,
} from "../-lib/tokens";
import { DialogNote } from "~/components/settings/dialog-note";

const styles = stylex.create({
  form: { display: "flex", flexDirection: "column", gap: space.inset },
  group: { display: "flex", flexDirection: "column", gap: space.sm },
  groupLabel: { fontSize: font.body, fontWeight: font.weightMedium, color: text.default },
  help: { margin: 0, fontSize: font.caption, color: text.muted },
  failure: { margin: 0, fontSize: font.body, color: status.danger },
  issued: { display: "flex", flexDirection: "column", gap: space.sm },
  tokenRow: { display: "flex", alignItems: "center", gap: space.sm, minWidth: 0 },
  code: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    paddingBlock: space.xs,
    paddingInline: space.sm,
    fontFamily: font.familyMono,
    fontSize: font.caption,
    color: text.default,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.item,
  },
});

export type IssueTokenFailure =
  | { kind: "expiry_too_long" }
  | { kind: "other"; message: string }
  | null;

export interface IssueTokenDialogProps {
  isOpen: boolean;
  role: Role;
  /** 発行直後の token。閉じるまで 1 回だけ見せる(null なら入力フォーム) */
  issued: Pick<IssuedToken, "token" | "expiresAt"> | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: IssueTokenInput) => void;
  isPending: boolean;
  failure: IssueTokenFailure;
}

// PAT_SCOPES の順に並べ直す(チェックの順で scopes が変わらないようにする)
function orderScopes(scopes: readonly PatScope[]): PatScope[] {
  return PAT_SCOPES.filter((scope) => scopes.includes(scope));
}

function IssueTokenForm({
  role,
  onOpenChange,
  onSubmit,
  isPending,
  failure,
}: Omit<IssueTokenDialogProps, "isOpen" | "issued">) {
  const labels = TOKEN_LABELS.issueDialog;
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<PatScope[]>([...DEFAULT_SCOPES]);
  // 期限はスコープの組み合わせで選択肢が変わるため、「既定のまま」を別に持つ
  const [chosenDays, setChosenDays] = useState<number | null>(null);
  const options = scopeOptionsFor(role);
  const expiryOptions = expiryOptionsFor(scopes);
  const expiresInDays =
    chosenDays !== null && expiryOptions.some((o) => o.days === chosenDays)
      ? chosenDays
      : defaultExpiryFor(scopes);
  const canSubmit = name.trim() !== "" && scopes.length > 0;
  const submit = () => {
    if (canSubmit && !isPending) onSubmit({ name: name.trim(), scopes, expiresInDays });
  };
  return (
    <ModalDialog
      title={labels.title}
      isOpen
      onOpenChange={onOpenChange}
      footer={
        <>
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            {DIALOGS.cancel}
          </Button>
          <Button variant="primary" isDisabled={!canSubmit || isPending} onPress={submit}>
            {labels.submit}
          </Button>
        </>
      }
    >
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          label={labels.name}
          description={labels.nameHelp}
          value={name}
          onChange={setName}
          isRequired
          autoComplete="off"
        />
        <div role="group" aria-label={labels.scopes} {...stylex.props(styles.group)}>
          <span {...stylex.props(styles.groupLabel)}>{labels.scopes}</span>
          {options.map((option) => (
            <Checkbox
              key={option.value}
              isSelected={scopes.includes(option.value)}
              onChange={(selected) =>
                setScopes((current) =>
                  orderScopes(
                    selected
                      ? [...current, option.value]
                      : current.filter((scope) => scope !== option.value),
                  ),
                )
              }
              description={option.description}
            >
              {option.label}
            </Checkbox>
          ))}
          <p {...stylex.props(styles.help)}>{labels.scopesHelp}</p>
          {lacksProposeFallback(scopes) ? (
            <p {...stylex.props(styles.help)}>{labels.noProposeNote}</p>
          ) : null}
        </div>
        <Select
          label={labels.expiry}
          items={expiryOptions.map((o) => ({ value: String(o.days), label: o.label }))}
          selectedValue={String(expiresInDays)}
          onChange={(value) => setChosenDays(Number(value))}
          {...(failure?.kind === "expiry_too_long" ? { errorMessage: labels.expiryTooLong } : {})}
        />
        {isReadOnlyScopes(scopes) ? null : (
          <p {...stylex.props(styles.help)}>{labels.writeExpiryNote}</p>
        )}
        {failure?.kind === "other" ? (
          <p role="alert" {...stylex.props(styles.failure)}>
            {failure.message}
          </p>
        ) : null}
      </form>
    </ModalDialog>
  );
}

function IssuedTokenView({
  issued,
  onOpenChange,
}: {
  issued: Pick<IssuedToken, "token" | "expiresAt">;
  onOpenChange: (open: boolean) => void;
}) {
  const labels = TOKEN_LABELS.issued;
  return (
    <ModalDialog
      title={labels.title}
      isOpen
      onOpenChange={onOpenChange}
      // 保存し忘れを防ぐ: 暗幕クリックや右上の × ではなく、注意書きの下の「閉じる」だけで閉じる
      isDismissable={false}
      showCloseButton={false}
      footer={
        <Button variant="primary" onPress={() => onOpenChange(false)}>
          {labels.close}
        </Button>
      }
    >
      <div {...stylex.props(styles.issued)}>
        <span {...stylex.props(styles.groupLabel)}>{labels.token}</span>
        <div {...stylex.props(styles.tokenRow)}>
          <code {...stylex.props(styles.code)}>{issued.token}</code>
          <Button
            variant="secondary"
            size="sm"
            icon={Copy}
            onPress={() => void copyText(issued.token)}
          >
            {labels.copy}
          </Button>
        </div>
        <DialogNote tone="warning" icon={TriangleAlert}>
          {labels.onceWarning}
        </DialogNote>
      </div>
    </ModalDialog>
  );
}

// 接続トークンの発行(M1-4)。閉じると描き直すので、開くたびに入力が初期化される
export function IssueTokenDialog({ isOpen, issued, ...rest }: IssueTokenDialogProps) {
  if (!isOpen) return null;
  if (issued !== null) return <IssuedTokenView issued={issued} onOpenChange={rest.onOpenChange} />;
  return <IssueTokenForm {...rest} />;
}
