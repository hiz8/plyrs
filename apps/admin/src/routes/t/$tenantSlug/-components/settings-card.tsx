import * as stylex from "@stylexjs/stylex";
import { useId, type ReactNode } from "react";
import { bg, border, font, radius, space, stroke, text } from "@plyrs/ui/semantic.stylex";

const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    minWidth: 0,
    backgroundColor: bg.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    padding: { default: space.lg, [NARROW]: space.md },
    fontFamily: font.family,
    color: text.default,
  },
  title: { margin: 0, fontSize: font.body, fontWeight: font.weightBold, color: text.default },
  description: { margin: 0, fontSize: font.caption, color: text.muted },
  footer: { display: "flex", justifyContent: "flex-end" },
});

export function SettingsCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} {...stylex.props(styles.card)}>
      <h2 id={titleId} {...stylex.props(styles.title)}>
        {title}
      </h2>
      {description === undefined ? null : (
        <p {...stylex.props(styles.description)}>{description}</p>
      )}
      {children}
      {footer === undefined ? null : <div {...stylex.props(styles.footer)}>{footer}</div>}
    </section>
  );
}
