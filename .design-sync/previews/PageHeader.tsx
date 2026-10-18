import { Banner, Button, PageHeader } from "@plyrs/ui";
import { Plus } from "lucide-react";

const crumbs = [
  { id: "home", label: "ホーム", href: "/t/acme" },
  { id: "news", label: "お知らせ" },
];

export const WithActions = () => (
  <div style={{ width: 760 }}>
    <PageHeader
      title="お知らせ"
      breadcrumbs={crumbs}
      secondaryActions={<Button variant="secondary">インポート</Button>}
      primaryAction={<Button icon={Plus}>お知らせを追加</Button>}
    />
  </div>
);

export const TitleOnly = () => (
  <div style={{ width: 760 }}>
    <PageHeader title="ホーム" />
  </div>
);

export const WithBanner = () => (
  <div style={{ width: 760 }}>
    <PageHeader
      title="お知らせ"
      breadcrumbs={crumbs}
      primaryAction={<Button>保存</Button>}
      banner={<Banner tone="warning">サーバーとの接続が切れています。再接続しています。</Banner>}
    />
  </div>
);
