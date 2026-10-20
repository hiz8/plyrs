import { Banner, Button } from "@plyrs/ui";
import { CONNECTION_BANNER } from "../lib/labels";

// §12 必須①: 初回同期後の切断・再同期はフォームを維持し、このバナーだけで知らせる。
// 保存(push)はアウトボックスに積まれ、接続回復後に自動送信される(engine の設計)。
// 表示するかどうかの判定は TenantPageHeader が持つ(ここは見た目だけ)。
export function ConnectionBanner({ onReconnect }: { onReconnect: () => void }) {
  return (
    <Banner
      tone="warning"
      action={
        <Button variant="secondary" size="sm" onPress={onReconnect}>
          {CONNECTION_BANNER.reconnect}
        </Button>
      }
    >
      {CONNECTION_BANNER.message}
    </Banner>
  );
}
