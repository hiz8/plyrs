import { IconButton } from "@plyrs/ui";
import { Pencil, Trash2, Copy, MoreHorizontal } from "lucide-react";

const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } as const;

export const Default = () => (
  <div style={row}>
    <IconButton icon={Pencil} label="編集" />
    <IconButton icon={Copy} label="複製" />
    <IconButton icon={Trash2} label="削除" />
    <IconButton icon={MoreHorizontal} label="その他の操作" />
  </div>
);

export const Small = () => (
  <div style={row}>
    <IconButton icon={Pencil} label="編集" size="sm" />
    <IconButton icon={Copy} label="複製" size="sm" />
    <IconButton icon={Trash2} label="削除" size="sm" />
  </div>
);

export const Disabled = () => (
  <div style={row}>
    <IconButton icon={Pencil} label="編集" isDisabled />
    <IconButton icon={Trash2} label="削除" disabledReason="公開中のお知らせは削除できません" />
  </div>
);
