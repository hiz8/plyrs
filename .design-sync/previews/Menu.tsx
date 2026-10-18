import { useEffect, useRef, type ReactNode } from "react";
import { Menu, MenuItem, MenuSection, MenuSeparator, IconButton, Button } from "@plyrs/ui";
import { Ellipsis, Pencil, Copy, Trash2, Archive } from "lucide-react";

const Opened = ({ children }: { children: ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.querySelector("button")?.click(), 50);
    return () => clearTimeout(t);
  }, []);
  return (
    <div ref={ref} style={{ padding: 8, minHeight: 300 }}>
      {children}
    </div>
  );
};

export const RowActions = () => (
  <Opened>
    <Menu label="行の操作" trigger={<IconButton icon={Ellipsis} label="その他" />} onAction={() => {}}>
      <MenuItem id="edit" icon={Pencil}>編集</MenuItem>
      <MenuItem id="copy" icon={Copy}>複製</MenuItem>
      <MenuItem id="archive" icon={Archive} isDisabled>アーカイブ</MenuItem>
      <MenuSeparator />
      <MenuItem id="delete" icon={Trash2} tone="danger">削除</MenuItem>
    </Menu>
  </Opened>
);

export const WithSections = () => (
  <Opened>
    <Menu label="ステータスを変更" trigger={<Button variant="secondary">ステータス</Button>} onAction={() => {}}>
      <MenuSection title="ステータス">
        <MenuItem id="draft">下書き</MenuItem>
        <MenuItem id="review">レビュー中</MenuItem>
        <MenuItem id="ready">公開準備完了</MenuItem>
      </MenuSection>
      <MenuSeparator />
      <MenuSection title="その他">
        <MenuItem id="archive" icon={Archive}>アーカイブ</MenuItem>
      </MenuSection>
    </Menu>
  </Opened>
);

export const CurrentSite = () => (
  <Opened>
    <Menu label="サイト切替" trigger={<Button variant="secondary">コーポレートサイト</Button>} onAction={() => {}}>
      <MenuSection title="サイト">
        <MenuItem id="corp" isCurrent>コーポレートサイト</MenuItem>
        <MenuItem id="blog">ブログ</MenuItem>
        <MenuItem id="recruit">採用サイト</MenuItem>
      </MenuSection>
    </Menu>
  </Opened>
);
