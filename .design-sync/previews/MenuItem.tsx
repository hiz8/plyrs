import { useEffect, useRef, type ReactNode } from "react";
import { Button, IconButton, Menu, MenuItem } from "@plyrs/ui";
import { Archive, Copy, Ellipsis, Eye, Globe, Pencil, Trash2 } from "lucide-react";

// Menu は開く props を持たないため、描画後にトリガーを押して開く(Menu.tsx と同じ方法)
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

export const WithIcons = () => (
  <Opened>
    <Menu label="行の操作" trigger={<IconButton icon={Ellipsis} label="その他" />} onAction={() => {}}>
      <MenuItem id="view" icon={Eye}>表示</MenuItem>
      <MenuItem id="edit" icon={Pencil}>編集</MenuItem>
      <MenuItem id="copy" icon={Copy}>複製</MenuItem>
    </Menu>
  </Opened>
);

export const DangerAndDisabled = () => (
  <Opened>
    <Menu label="公開の操作" trigger={<IconButton icon={Ellipsis} label="その他" />} onAction={() => {}}>
      <MenuItem id="unpublish" icon={Globe} isDisabled>公開を取り下げる</MenuItem>
      <MenuItem id="archive" icon={Archive}>アーカイブ</MenuItem>
      <MenuItem id="delete" icon={Trash2} tone="danger">削除</MenuItem>
    </Menu>
  </Opened>
);

export const Current = () => (
  <Opened>
    <Menu label="サイトを切り替え" trigger={<Button variant="secondary">コーポレートサイト</Button>} onAction={() => {}}>
      <MenuItem id="corp" isCurrent>コーポレートサイト</MenuItem>
      <MenuItem id="blog">スタッフブログ</MenuItem>
      <MenuItem id="recruit">採用サイト</MenuItem>
    </Menu>
  </Opened>
);
