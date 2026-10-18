import { Button } from "@plyrs/ui";
import { Plus, Upload } from "lucide-react";

const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } as const;

export const Variants = () => (
  <div style={row}>
    <Button variant="primary" icon={Plus}>
      お知らせを追加
    </Button>
    <Button variant="secondary" icon={Upload}>
      インポート
    </Button>
    <Button variant="danger">削除する</Button>
    <Button variant="link">すべて表示</Button>
    <Button variant="dangerLink">削除</Button>
  </div>
);

export const Small = () => (
  <div style={row}>
    <Button variant="primary" size="sm">
      公開
    </Button>
    <Button variant="secondary" size="sm">
      ステータスを変更
    </Button>
    <Button variant="danger" size="sm">
      削除
    </Button>
  </div>
);

export const Disabled = () => (
  <div style={row}>
    <Button variant="primary" isDisabled>
      保存
    </Button>
    <Button variant="primary" disabledReason="接続が切れているため公開できません">
      公開
    </Button>
    <Button variant="secondary" isDisabled>
      キャンセル
    </Button>
  </div>
);
