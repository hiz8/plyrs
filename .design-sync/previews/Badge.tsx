import { Badge } from "@plyrs/ui";
import { Globe } from "lucide-react";

const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } as const;

export const Tones = () => (
  <div style={row}>
    <Badge tone="neutral">下書き</Badge>
    <Badge tone="accent">レビュー中</Badge>
    <Badge tone="success">公開準備完了</Badge>
    <Badge tone="warning">未反映の変更あり</Badge>
    <Badge tone="danger">公開に失敗</Badge>
  </div>
);

export const PublishStatusDots = () => (
  <div style={row}>
    <Badge tone="success" dot>
      公開中
    </Badge>
    <Badge tone="warning" dot>
      未反映の変更あり
    </Badge>
    <Badge tone="neutral" dot>
      未公開
    </Badge>
  </div>
);

export const WithIcon = () => (
  <div style={row}>
    <Badge tone="success" icon={Globe}>
      公開中
    </Badge>
  </div>
);

export const StruckAndMonospace = () => (
  <div style={row}>
    <Badge tone="neutral" isStruck>
      アーカイブ
    </Badge>
    <Badge tone="neutral" isMonospace>
      news.announcement
    </Badge>
  </div>
);
