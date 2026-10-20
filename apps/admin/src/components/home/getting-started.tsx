import * as stylex from "@stylexjs/stylex";
import { LayoutGrid } from "lucide-react";
import { useId } from "react";
import { Button, EmptyState } from "@plyrs/ui";
import { accent, bg, border, font, radius, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import { HOME_LABELS } from "../../lib/labels";

const NARROW = "@media (max-width: 959px)";

// b-home.md 2.6: 枠は 760px まで、手順の番号の円は 32px
const MAX_WIDTH = "760px";
const STEP_CIRCLE = "32px";

const styles = stylex.create({
  card: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: MAX_WIDTH,
    backgroundColor: bg.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    padding: { default: space.lg, [NARROW]: space.md },
    fontFamily: font.family,
    color: text.default,
  },
  title: { margin: 0, fontSize: font.sectionTitle, fontWeight: font.weightBold },
  description: { margin: 0, marginTop: space.xs, fontSize: font.body, color: text.muted },
  steps: {
    listStyle: "none",
    margin: 0,
    marginTop: space.md,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.md,
  },
  step: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.inset,
    paddingTop: space.md,
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
  },
  circle: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: STEP_CIRCLE,
    height: STEP_CIRCLE,
    borderRadius: radius.full,
    backgroundColor: accent.surface,
    color: accent.default,
    fontSize: font.body,
    fontWeight: font.weightBold,
  },
  stepBody: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.xs,
    minWidth: 0,
  },
  stepTitle: { margin: 0, fontSize: font.label, fontWeight: font.weightBold },
  stepText: { margin: 0, fontSize: font.body, color: text.muted },
  action: { marginTop: space.xs },
  notice: { width: "100%", maxWidth: MAX_WIDTH },
});

// 型が 0 件のときの管理者向け案内(裁定 B4)
export function GettingStarted({
  siteName,
  onCreateType,
  onOpenMedia,
  onInviteMembers,
}: {
  siteName: string;
  onCreateType: () => void;
  onOpenMedia: () => void;
  onInviteMembers: () => void;
}) {
  const titleId = useId();
  const labels = HOME_LABELS.gettingStarted;
  const steps = [
    { ...labels.createType, variant: "primary" as const, onPress: onCreateType },
    { ...labels.uploadMedia, variant: "secondary" as const, onPress: onOpenMedia },
    { ...labels.inviteMembers, variant: "secondary" as const, onPress: onInviteMembers },
  ];
  return (
    <section aria-labelledby={titleId} {...stylex.props(styles.card)}>
      <h2 id={titleId} {...stylex.props(styles.title)}>
        {labels.title}
      </h2>
      <p {...stylex.props(styles.description)}>{labels.description(siteName)}</p>
      <ol {...stylex.props(styles.steps)}>
        {steps.map((step, index) => (
          <li key={step.title} {...stylex.props(styles.step)}>
            <span aria-hidden="true" {...stylex.props(styles.circle)}>
              {index + 1}
            </span>
            <div {...stylex.props(styles.stepBody)}>
              <h3 {...stylex.props(styles.stepTitle)}>{step.title}</h3>
              <p {...stylex.props(styles.stepText)}>{step.body}</p>
              <div {...stylex.props(styles.action)}>
                <Button variant={step.variant} onPress={step.onPress}>
                  {step.action}
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// 管理者以外には依頼の案内だけを出す(メールアドレスは出さない)
export function NoTypesNotice() {
  return (
    <div {...stylex.props(styles.notice)}>
      <EmptyState
        icon={LayoutGrid}
        title={HOME_LABELS.noTypes.title}
        description={HOME_LABELS.noTypes.description}
      />
    </div>
  );
}
