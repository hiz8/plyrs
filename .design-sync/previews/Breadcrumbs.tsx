import { Breadcrumbs } from "@plyrs/ui";

export const Nested = () => (
  <Breadcrumbs
    items={[
      { id: "home", label: "ホーム", href: "/t/acme" },
      { id: "news", label: "お知らせ", href: "/t/acme/news" },
      { id: "rec", label: "年末年始の営業について" },
    ]}
  />
);

export const TwoLevels = () => (
  <Breadcrumbs
    items={[
      { id: "home", label: "ホーム", href: "/t/acme" },
      { id: "media", label: "メディア" },
    ]}
  />
);
