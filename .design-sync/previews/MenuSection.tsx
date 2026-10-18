import { useEffect, useRef, type ReactNode } from "react";
import { Button, Menu, MenuItem, MenuSection, MenuSeparator } from "@plyrs/ui";
import { LogOut, Settings, User } from "lucide-react";

// Menu は開く props を持たないため、描画後にトリガーを押して開く(Menu.tsx と同じ方法)
const Opened = ({ children }: { children: ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.querySelector("button")?.click(), 50);
    return () => clearTimeout(t);
  }, []);
  return (
    <div ref={ref} style={{ padding: 8, minHeight: 320 }}>
      {children}
    </div>
  );
};

export const AccountMenu = () => (
  <Opened>
    <Menu label="アカウント" trigger={<Button variant="secondary">山田 花子</Button>} onAction={() => {}}>
      <MenuSection title="hanako@example.com">
        <MenuItem id="account" icon={User}>アカウント設定</MenuItem>
        <MenuItem id="site" icon={Settings}>サイトの設定</MenuItem>
      </MenuSection>
      <MenuSeparator />
      <MenuSection>
        <MenuItem id="logout" icon={LogOut}>ログアウト</MenuItem>
      </MenuSection>
    </Menu>
  </Opened>
);

export const TitledSections = () => (
  <Opened>
    <Menu label="ステータスを変更" trigger={<Button variant="secondary">ステータスを変更</Button>} onAction={() => {}}>
      <MenuSection title="作業中">
        <MenuItem id="draft">下書き</MenuItem>
        <MenuItem id="review">レビュー中</MenuItem>
      </MenuSection>
      <MenuSection title="公開前">
        <MenuItem id="ready">公開準備完了</MenuItem>
      </MenuSection>
    </Menu>
  </Opened>
);
