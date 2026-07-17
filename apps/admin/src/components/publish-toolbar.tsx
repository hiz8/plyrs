import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { publicationQueryOptions } from "../lib/queries";

const styles = stylex.create({
  root: { display: "flex", alignItems: "center", gap: spacing.sm },
  error: { color: colors.danger, fontSize: typography.sizeSm },
});

const tenantRoute = getRouteApi("/t/$tenantSlug");

// 裁定 5: publish/unpublish はコアの record-editor:toolbar contribution。
// design-spec §11: record:publish は owner/editor（viewer は無効化。判定はサーバーが最終権威）。
export function PublishToolbar({ recordId }: { typeKey: string; recordId: string }) {
  const { tenant, adminApi, queryClient } = tenantRoute.useRouteContext();
  const publication = useQuery(publicationQueryOptions(adminApi, tenant.id, recordId));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canPublish = tenant.role !== "viewer";

  async function run(action: "publish" | "unpublish") {
    setError(null);
    setBusy(true);
    try {
      if (action === "publish") {
        await adminApi.publishRecord(tenant.id, recordId);
      } else {
        await adminApi.unpublishRecord(tenant.id, recordId);
      }
      await queryClient.invalidateQueries({
        queryKey: publicationQueryOptions(adminApi, tenant.id, recordId).queryKey,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div {...stylex.props(styles.root)}>
      <Button isDisabled={!canPublish || busy} onPress={() => void run("publish")}>
        公開
      </Button>
      {publication.data?.published === true && (
        <Button
          variant="secondary"
          isDisabled={!canPublish || busy}
          onPress={() => void run("unpublish")}
        >
          公開を取り下げ
        </Button>
      )}
      {error !== null && <span {...stylex.props(styles.error)}>{error}</span>}
    </div>
  );
}
