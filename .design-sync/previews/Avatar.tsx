import { Avatar } from "@plyrs/ui";

const row = { display: "flex", alignItems: "center", gap: 16 } as const;

export const Sizes = () => (
  <div style={row}>
    <Avatar name="山田 太郎" size="sm" />
    <Avatar name="山田 太郎" size="md" />
    <Avatar name="Hirofumi Iji" size="md" />
  </div>
);
