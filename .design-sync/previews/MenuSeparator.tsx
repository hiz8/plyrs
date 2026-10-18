import { useEffect, useRef, type ReactNode } from "react";
import { Button, IconButton, Menu, MenuItem, MenuSeparator } from "@plyrs/ui";
import { Copy, Ellipsis, Globe, Pencil, Trash2 } from "lucide-react";

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

export const BeforeDanger = () => (
  <Opened>
    <Menu label="行の操作" trigger={<IconButton icon={Ellipsis} label="その他" />} onAction={() => {}}>
      <MenuItem id="edit" icon={Pencil}>編集</MenuItem>
      <MenuItem id="copy" icon={Copy}>複製</MenuItem>
      <MenuSeparator />
      <MenuItem id="delete" icon={Trash2} tone="danger">削除</MenuItem>
    </Menu>
  </Opened>
);

export const BetweenGroups = () => (
  <Opened>
    <Menu label="一括操作" trigger={<Button variant="secondary" size="sm">一括操作</Button>} onAction={() => {}}>
      <MenuItem id="publish" icon={Globe}>公開</MenuItem>
      <MenuItem id="unpublish">公開を取り下げ</MenuItem>
      <MenuSeparator />
      <MenuItem id="status">ステータスを変更</MenuItem>
      <MenuSeparator />
      <MenuItem id="delete" icon={Trash2} tone="danger">削除</MenuItem>
    </Menu>
  </Opened>
);
