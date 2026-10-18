import { Banner, Button } from "@plyrs/ui";

const col = { display: "flex", flexDirection: "column", gap: 12 } as const;

export const Warning = () => (
  <Banner tone="warning" action={<Button variant="secondary" size="sm">今すぐ再接続</Button>}>
    接続が切れています。変更はこの端末に保存され、再接続後に反映されます。
  </Banner>
);

export const Danger = () => (
  <Banner tone="danger">公開に失敗しました。時間をおいてもう一度お試しください。</Banner>
);

export const Both = () => (
  <div style={col}>
    <Banner tone="warning">未反映の変更が 3 件あります。</Banner>
    <Banner tone="danger" action={<Button variant="secondary" size="sm">再試行</Button>}>
      メディアのアップロードに失敗しました。
    </Banner>
  </div>
);
