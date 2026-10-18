import { Button, EmptyState } from "@plyrs/ui";
import { FileText, Image, Plus, SearchX } from "lucide-react";

export const Default = () => (
  <EmptyState
    icon={FileText}
    title="お知らせがまだありません"
    description="最初のお知らせを作成すると、ここに一覧で表示されます。"
    action={
      <Button variant="primary" icon={Plus}>
        お知らせを追加
      </Button>
    }
  />
);

export const FilteredEmpty = () => (
  <EmptyState
    icon={SearchX}
    title="条件に一致するイベントがありません"
    description="絞り込みを変更するか、解除してください。"
    action={<Button variant="link">絞り込みを解除</Button>}
  />
);

export const Compact = () => (
  <EmptyState size="compact" icon={Image} title="メディアがありません" description="ファイルをドロップして追加できます。" />
);
