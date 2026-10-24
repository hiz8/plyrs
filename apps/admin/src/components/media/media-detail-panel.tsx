import * as stylex from "@stylexjs/stylex";
import { Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-aria-components";
import { Badge, Button, SidePanel, Skeleton, TextField } from "@plyrs/ui";
import { accent, border, font, space, status, stroke, text } from "@plyrs/ui/semantic.stylex";
import { copyText } from "../../lib/clipboard";
import { formatDateTime } from "../../lib/datetime";
import { MEDIA_LABELS, TERMS } from "../../lib/labels";
import type { ResolvedUsage } from "../../lib/media";
import { formatBytes, type MediaRow } from "../../lib/media-list";
import { MediaThumb, type MediaThumbProps } from "./media-thumb";

const L = MEDIA_LABELS.detail;

const styles = stylex.create({
  section: { display: "flex", flexDirection: "column", gap: space.sm },
  divider: {
    margin: 0,
    borderWidth: 0,
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
  },
  // F 4 章: プレビューの右下に大きさのバッジを重ねる
  preview: { position: "relative" },
  previewBadge: { position: "absolute", insetInlineEnd: space.sm, insetBlockEnd: space.sm },
  // F 4 章: 見出し列 88px
  info: {
    display: "grid",
    gridTemplateColumns: "88px 1fr",
    gap: space.xs,
    margin: 0,
    fontSize: font.caption,
  },
  term: { margin: 0, color: text.muted },
  value: { margin: 0, color: text.default, overflowWrap: "anywhere" },
  mono: { fontFamily: font.familyMono },
  save: { display: "flex", justifyContent: "flex-end" },
  heading: {
    display: "flex",
    alignItems: "baseline",
    gap: space.sm,
    margin: 0,
    fontSize: font.label,
    fontWeight: font.weightBold,
    color: text.default,
  },
  count: { fontSize: font.caption, fontWeight: font.weightRegular, color: text.muted },
  note: { margin: 0, fontSize: font.caption, color: text.muted },
  error: { display: "flex", alignItems: "center", gap: space.sm, fontSize: font.caption },
  errorText: { color: status.danger },
  urlRow: { display: "flex", alignItems: "center", gap: space.sm },
  url: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: font.familyMono,
    fontSize: font.caption,
    color: text.default,
  },
  usageList: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  usageItem: { display: "flex", flexDirection: "column", fontSize: font.caption },
  usageLink: {
    color: accent.default,
    fontWeight: font.weightMedium,
    textDecoration: { default: "none", ":hover": "underline" },
  },
  usageTitle: { color: text.default, fontWeight: font.weightMedium },
  usagePlace: { color: text.muted },
});

type Retryable = { status: "pending" } | { status: "error"; onRetry: () => void };

export interface MediaDetailPanelProps {
  tenantSlug: string;
  tenantId: string;
  /** null = 閉じる(isOpen false の SidePanel を返す。V4-E の最終 fix と同じ) */
  row: MediaRow | null;
  isOpen: boolean;
  /** assetId があるのに row が無い(見つからない文だけを描く) */
  notFound: boolean;
  resolveUrl: MediaThumbProps["resolveUrl"];
  usage: Retryable | { status: "ready"; entries: readonly ResolvedUsage[] };
  publication: Retryable | { status: "ready"; published: boolean; url: string };
  canWrite: boolean;
  canDelete: boolean;
  /** 同期経路での保存(F13)。失敗の知らせは呼び出し側 */
  onSave: (input: { alt: string; caption: string }) => Promise<void>;
  /** 確認は呼び出し側(F37) */
  onDelete: () => void;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLElement | null>;
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.section)}>
      <h3 {...stylex.props(styles.heading)}>
        {title}
        {aside !== undefined && <span {...stylex.props(styles.count)}>{aside}</span>}
      </h3>
      {children}
    </div>
  );
}

function FetchError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div {...stylex.props(styles.error)}>
      <span {...stylex.props(styles.errorText)}>{message}</span>
      <Button variant="link" size="sm" onPress={onRetry}>
        {MEDIA_LABELS.retry}
      </Button>
    </div>
  );
}

// 詳細パネル(F 4 章、M2・M8・C2。F1・F8・F13・F14・F29)
export function MediaDetailPanel({
  tenantSlug,
  row,
  isOpen,
  notFound,
  resolveUrl,
  usage,
  publication,
  canWrite,
  canDelete,
  onSave,
  onDelete,
  onClose,
  returnFocusTo,
}: MediaDetailPanelProps) {
  const [alt, setAlt] = useState(row?.alt ?? "");
  const [caption, setCaption] = useState(row?.caption ?? "");
  const [isSaving, setIsSaving] = useState(false);

  // 入力の取り直しは id にだけ結ぶ。同期で同じ id の行が差し替わっても入力中の値は保つ
  // (V4-E Task 8 の Important)
  // 同じ id の行が差し替わったときは、触っていない欄(下書きが行の旧値のまま)だけ新しい値に追従する
  const rowId = row?.id ?? null;
  const rowAlt = row?.alt ?? "";
  const rowCaption = row?.caption ?? "";
  const previous = useRef({ id: rowId, alt: rowAlt, caption: rowCaption });
  useEffect(() => {
    const before = previous.current;
    previous.current = { id: rowId, alt: rowAlt, caption: rowCaption };
    if (before.id !== rowId) {
      setAlt(rowAlt);
      setCaption(rowCaption);
      return;
    }
    setAlt((draft) => (draft === before.alt ? rowAlt : draft));
    setCaption((draft) => (draft === before.caption ? rowCaption : draft));
  }, [rowId, rowAlt, rowCaption]);

  // 閉じても SidePanel は外さない(isOpen の true → false でフォーカスを戻すため)
  if (!isOpen || (row === null && !notFound)) {
    return (
      <SidePanel isOpen={false} onClose={onClose} title="" returnFocusTo={returnFocusTo}>
        {null}
      </SidePanel>
    );
  }

  if (row === null) {
    return (
      <SidePanel
        isOpen
        onClose={onClose}
        title={TERMS.media}
        returnFocusTo={returnFocusTo}
        width={360}
        narrowLayout="sheet"
      >
        <p {...stylex.props(styles.note)}>{L.notFound}</p>
      </SidePanel>
    );
  }

  const dirty = alt !== row.alt || caption !== row.caption;
  const uploaded = row.uploadedAt === null ? null : formatDateTime(row.uploadedAt).absolute;
  const save = async () => {
    setIsSaving(true);
    try {
      await onSave({ alt, caption });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SidePanel
      isOpen
      onClose={onClose}
      title={row.filename}
      returnFocusTo={returnFocusTo}
      width={360}
      narrowLayout="sheet"
      footer={
        canDelete ? (
          <Button variant="dangerLink" onPress={onDelete}>
            {L.delete}
          </Button>
        ) : undefined
      }
    >
      <div {...stylex.props(styles.preview)}>
        <MediaThumb row={row} resolveUrl={resolveUrl} size="preview" eager />
        {row.width !== null && row.height !== null && (
          <span {...stylex.props(styles.previewBadge)}>
            <span aria-hidden="true">
              <Badge tone="neutral">{L.dimensionsOf(row.width, row.height)}</Badge>
            </span>
          </span>
        )}
      </div>
      <dl {...stylex.props(styles.info)}>
        <dt {...stylex.props(styles.term)}>{L.kind}</dt>
        <dd {...stylex.props(styles.value, styles.mono)}>{row.contentType}</dd>
        <dt {...stylex.props(styles.term)}>{L.size}</dt>
        <dd {...stylex.props(styles.value)}>{formatBytes(row.size)}</dd>
        {row.width !== null && row.height !== null && (
          <>
            <dt {...stylex.props(styles.term)}>{L.dimensions}</dt>
            <dd {...stylex.props(styles.value)}>{L.dimensionsOf(row.width, row.height)}</dd>
          </>
        )}
        {uploaded !== null && (
          <>
            <dt {...stylex.props(styles.term)}>{L.uploaded}</dt>
            <dd {...stylex.props(styles.value)}>{uploaded}</dd>
          </>
        )}
      </dl>
      <hr {...stylex.props(styles.divider)} />
      <div {...stylex.props(styles.section)}>
        <TextField
          label={L.alt}
          description={L.altHelp}
          value={alt}
          onChange={setAlt}
          isReadOnly={!canWrite}
        />
        <TextField
          label={L.caption}
          placeholder={L.captionPlaceholder}
          description={L.captionHelp}
          value={caption}
          onChange={setCaption}
          isReadOnly={!canWrite}
        />
        {canWrite && (
          <div {...stylex.props(styles.save)}>
            <Button variant="primary" size="sm" isDisabled={!dirty || isSaving} onPress={save}>
              {L.save}
            </Button>
          </div>
        )}
      </div>
      <hr {...stylex.props(styles.divider)} />
      <Section title={L.publication}>
        {publication.status === "pending" ? (
          <Skeleton height={20} />
        ) : publication.status === "error" ? (
          <FetchError message={L.publicationFailed} onRetry={publication.onRetry} />
        ) : publication.published ? (
          <>
            <div>
              <Badge tone="success" dot>
                {L.published}
              </Badge>
            </div>
            <p {...stylex.props(styles.note)}>{L.publishedNote}</p>
            <div {...stylex.props(styles.urlRow)}>
              <span title={publication.url} {...stylex.props(styles.url)}>
                {publication.url}
              </span>
              <Button
                variant="secondary"
                size="sm"
                icon={Copy}
                onPress={() => void copyText(publication.url)}
              >
                {L.copy}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div>
              <Badge tone="neutral">{L.unpublished}</Badge>
            </div>
            <p {...stylex.props(styles.note)}>{L.unpublishedNote}</p>
          </>
        )}
      </Section>
      <hr {...stylex.props(styles.divider)} />
      <Section
        title={L.usage}
        {...(usage.status === "ready" ? { aside: L.usageCount(usage.entries.length) } : {})}
      >
        {usage.status === "pending" ? (
          <Skeleton height={40} />
        ) : usage.status === "error" ? (
          <FetchError message={L.usageFailed} onRetry={usage.onRetry} />
        ) : usage.entries.length === 0 ? (
          <p {...stylex.props(styles.note)}>{L.usageEmpty}</p>
        ) : (
          <ul {...stylex.props(styles.usageList)}>
            {usage.entries.map((entry) => (
              <li
                key={`${entry.recordId}:${entry.fieldKey}:${entry.origin}`}
                {...stylex.props(styles.usageItem)}
              >
                {entry.typeKey === null ? (
                  <span {...stylex.props(styles.usageTitle)}>{entry.title}</span>
                ) : (
                  <Link
                    href={`/t/${tenantSlug}/content/${entry.typeKey}/${entry.recordId}`}
                    {...stylex.props(styles.usageLink)}
                  >
                    {entry.title}
                  </Link>
                )}
                <span {...stylex.props(styles.usagePlace)}>
                  {entry.typeName}
                  {L.separator}
                  {entry.place}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p {...stylex.props(styles.note)}>{L.replaceHint}</p>
      </Section>
    </SidePanel>
  );
}
