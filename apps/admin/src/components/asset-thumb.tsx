import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { border, font, radius, stroke, text } from "@plyrs/ui/semantic.stylex";

const styles = stylex.create({
  image: {
    width: "48px",
    height: "48px",
    objectFit: "cover",
    borderRadius: radius.control,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
  },
  fallback: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "48px",
    height: "48px",
    borderRadius: radius.control,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    color: text.muted,
    fontSize: font.caption,
    textTransform: "uppercase",
  },
});

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "?" : filename.slice(dot + 1, dot + 5);
}

export function AssetThumb({
  record,
  resolveUrl,
}: {
  record: SyncRecord;
  resolveUrl: (assetId: string) => Promise<string | null>;
}) {
  const contentType =
    typeof record.input["content_type"] === "string" ? record.input["content_type"] : "";
  const filename = typeof record.input["filename"] === "string" ? record.input["filename"] : "";
  const alt = typeof record.input["alt"] === "string" ? record.input["alt"] : filename;
  const isImage = contentType.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) {
      return;
    }
    let cancelled = false;
    void resolveUrl(record.id).then((next) => {
      if (!cancelled) {
        setUrl(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [record.id, isImage, resolveUrl]);

  if (!isImage || url === null) {
    return <span {...stylex.props(styles.fallback)}>{extensionOf(filename)}</span>;
  }
  return <img src={url} alt={alt} {...stylex.props(styles.image)} />;
}
