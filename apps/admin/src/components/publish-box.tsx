import * as stylex from "@stylexjs/stylex";
import { Info, Pencil, RotateCw } from "lucide-react";
import { useId } from "react";
import { WORKFLOW_STATUSES, type WorkflowStatus } from "@plyrs/metamodel";
import { Button, ICON_SIZE, Select, Skeleton } from "@plyrs/ui";
import {
  bg,
  border,
  elevation,
  font,
  layer,
  radius,
  space,
  status as statusToken,
  stroke,
  text,
} from "@plyrs/ui/semantic.stylex";
import { formatAbsolute } from "../lib/datetime";
import { PUBLISH_BOX, WORKFLOW_STATUS_LABELS } from "../lib/labels";
import type { PublishBoxButton, PublishBoxView } from "../lib/publish-box";
import { PublicationBadge } from "./publication-badge";

const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.inset,
    padding: space.md,
    backgroundColor: bg.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
  },
  title: {
    margin: 0,
    fontFamily: font.family,
    fontSize: font.body,
    fontWeight: font.weightMedium,
    color: text.default,
  },
  row: { display: "flex", alignItems: "flex-start", gap: space.sm },
  // 部品固有の値: 「状態」「ステータス」のラベル列の幅
  label: {
    width: "64px",
    flexShrink: 0,
    fontSize: font.caption,
    color: text.muted,
  },
  value: { display: "flex", flexDirection: "column", gap: space.xs, minWidth: 0, flexGrow: 1 },
  muted: { fontSize: font.caption, color: text.muted },
  notSaved: { fontSize: font.caption, color: text.muted },
  notes: { display: "flex", flexDirection: "column", gap: space.xs },
  note: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    fontSize: font.caption,
  },
  changedNote: { color: text.default, fontWeight: font.weightMedium },
  unsavedNote: { color: text.default },
  // 部品固有の値: 注記の点の直径
  dot: {
    width: "6px",
    height: "6px",
    flexShrink: 0,
    borderRadius: radius.full,
    backgroundColor: statusToken.warning,
  },
  buttons: { display: "flex", justifyContent: "flex-end", gap: space.sm },
  offline: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.xs,
    fontSize: font.caption,
    color: text.muted,
  },
  offlineIcon: { flexShrink: 0 },
  unpublish: { display: "flex", justifyContent: "flex-end" },
  delete: {
    display: "flex",
    justifyContent: "flex-start",
    paddingTop: space.sm,
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
  },
  bar: {
    position: "fixed",
    insetInline: 0,
    insetBlockEnd: 0,
    display: { default: "none", [NARROW]: "flex" },
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    padding: `${space.inset} ${space.md}`,
    backgroundColor: bg.raised,
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
    boxShadow: elevation.menu,
    zIndex: layer.dropdown,
  },
  barNotes: { flexGrow: 1, minWidth: 0 },
});

export interface PublishBoxProps {
  view: PublishBoxView;
  status: WorkflowStatus;
  onPrimary: () => void;
  onSecondary: () => void;
  onStatusChange: (next: WorkflowStatus) => void;
  onUnpublish: () => void;
  onDelete: () => void;
  /** 公開状態の取得に失敗したときの再試行 */
  onRetryPublication?: () => void;
}

const STATUS_ITEMS = WORKFLOW_STATUSES.map((value) => ({
  value,
  label: WORKFLOW_STATUS_LABELS[value],
}));

function isWorkflowStatus(value: string): value is WorkflowStatus {
  return (WORKFLOW_STATUSES as readonly string[]).includes(value);
}

function ActionButton({
  button,
  variant,
  onPress,
}: {
  button: PublishBoxButton;
  variant: "primary" | "secondary";
  onPress: () => void;
}) {
  return button.disabledReason !== undefined ? (
    <Button variant={variant} onPress={onPress} disabledReason={button.disabledReason}>
      {button.label}
    </Button>
  ) : (
    <Button variant={variant} onPress={onPress} isDisabled={button.isDisabled}>
      {button.label}
    </Button>
  );
}

function Notes({ view }: { view: PublishBoxView }) {
  if (!view.notes.changed && !view.notes.unsaved) return null;
  return (
    <div {...stylex.props(styles.notes)}>
      {view.notes.changed && (
        <div {...stylex.props(styles.note, styles.changedNote)}>
          <span aria-hidden="true" {...stylex.props(styles.dot)} />
          <span>{PUBLISH_BOX.changed}</span>
        </div>
      )}
      {view.notes.unsaved && (
        <div {...stylex.props(styles.note, styles.unsavedNote)}>
          <Pencil size={ICON_SIZE.inline} aria-hidden="true" />
          <span>{PUBLISH_BOX.unsaved}</span>
        </div>
      )}
    </div>
  );
}

function Buttons({
  view,
  onPrimary,
  onSecondary,
}: Pick<PublishBoxProps, "view" | "onPrimary" | "onSecondary">) {
  if (view.primary === null && view.secondary === null) return null;
  return (
    <div {...stylex.props(styles.buttons)}>
      {view.secondary !== null && (
        <ActionButton button={view.secondary} variant="secondary" onPress={onSecondary} />
      )}
      {view.primary !== null && (
        <ActionButton button={view.primary} variant="primary" onPress={onPrimary} />
      )}
    </div>
  );
}

function StateRow({
  view,
  onRetryPublication,
}: {
  view: PublishBoxView;
  onRetryPublication: (() => void) | undefined;
}) {
  const state = view.state;
  if (state.kind === "asset") return null;
  return (
    <div {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.label)}>{PUBLISH_BOX.state}</span>
      <div {...stylex.props(styles.value)}>
        {state.kind === "new" && (
          <span {...stylex.props(styles.notSaved)}>{PUBLISH_BOX.notSaved}</span>
        )}
        {state.kind === "loading" && (
          <span role="status" aria-label={PUBLISH_BOX.loading}>
            <Skeleton width={96} height={20} />
          </span>
        )}
        {state.kind === "error" && (
          <>
            <span role="alert" {...stylex.props(styles.muted)}>
              {PUBLISH_BOX.loadFailed}
            </span>
            <Button
              variant="link"
              size="sm"
              icon={RotateCw}
              {...(onRetryPublication === undefined ? {} : { onPress: onRetryPublication })}
            >
              {PUBLISH_BOX.retry}
            </Button>
          </>
        )}
        {state.kind === "unpublished" && <PublicationBadge state="unpublished" />}
        {state.kind === "published" && (
          <>
            <PublicationBadge state={state.changed ? "changed" : "published"} />
            <span {...stylex.props(styles.muted)}>
              {PUBLISH_BOX.publishedAt(formatAbsolute(new Date(state.publishedAt)))}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function PublishBox({
  view,
  status,
  onPrimary,
  onSecondary,
  onStatusChange,
  onUnpublish,
  onDelete,
  onRetryPublication,
}: PublishBoxProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} {...stylex.props(styles.card)}>
      <h2 id={titleId} {...stylex.props(styles.title)}>
        {PUBLISH_BOX.title}
      </h2>
      <StateRow view={view} onRetryPublication={onRetryPublication} />
      <Notes view={view} />
      {view.showStatus && (
        <Select
          label={PUBLISH_BOX.status}
          items={STATUS_ITEMS}
          selectedValue={status}
          onChange={(value) => {
            if (isWorkflowStatus(value)) onStatusChange(value);
          }}
          isReadOnly={view.readOnly}
          size="sm"
        />
      )}
      <Buttons view={view} onPrimary={onPrimary} onSecondary={onSecondary} />
      {view.offlineNote !== null && (
        <div {...stylex.props(styles.offline)}>
          <span {...stylex.props(styles.offlineIcon)}>
            <Info size={ICON_SIZE.inline} aria-hidden="true" />
          </span>
          <span>{view.offlineNote}</span>
        </div>
      )}
      {view.showUnpublish && (
        <div {...stylex.props(styles.unpublish)}>
          <Button variant="dangerLink" size="sm" onPress={onUnpublish}>
            {PUBLISH_BOX.unpublish}
          </Button>
        </div>
      )}
      {view.showDelete && (
        <div {...stylex.props(styles.delete)}>
          <Button variant="dangerLink" size="sm" onPress={onDelete}>
            {PUBLISH_BOX.delete}
          </Button>
        </div>
      )}
    </section>
  );
}

// 狭い画面(幅 960px 未満)で下部に固定する操作バー。注記は左、ボタンは右
export function PublishBar({
  view,
  onPrimary,
  onSecondary,
}: Pick<PublishBoxProps, "view" | "onPrimary" | "onSecondary">) {
  if (view.primary === null && view.secondary === null) return null;
  return (
    <div role="region" aria-label={PUBLISH_BOX.actionsRegion} {...stylex.props(styles.bar)}>
      <div {...stylex.props(styles.barNotes)}>
        <Notes view={view} />
      </div>
      <Buttons view={view} onPrimary={onPrimary} onSecondary={onSecondary} />
    </div>
  );
}
