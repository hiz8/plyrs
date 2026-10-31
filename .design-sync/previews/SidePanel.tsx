import { Button, Checkbox, Select, SidePanel, TextField } from "@plyrs/ui";

// SidePanel は position: fixed(top 0 / bottom 0)で画面の高さに従う。撮影では高さが測れないため、
// transform を持つ枠を包含ブロックにして 720×460 の画面を作る。
// 撮影幅が 960px 未満なので、narrowLayout の既定(full)は全面のシート、sheet は下から出る面として写る。
// 幅 420px / 360px の右パネルは実際の画面(960px 以上)でだけ見える
const screen = {
  position: "relative",
  width: 720,
  height: 460,
  overflow: "hidden",
  transform: "translateZ(0)",
  background: "#f3f4f6",
} as const;
const form = { display: "flex", flexDirection: "column", gap: 16 } as const;
const footer = { display: "flex", justifyContent: "flex-end", gap: 8 } as const;
const noop = () => {};

export const FieldSettings = () => (
  <div style={screen}>
    <SidePanel
      isOpen
      onClose={noop}
      title="公開日"
      subtitle="種類: 日時"
      footer={
        <div style={footer}>
          <Button variant="secondary">キャンセル</Button>
          <Button variant="primary">適用</Button>
        </div>
      }
    >
      <div style={form}>
        <Select
          label="種類"
          selectedValue="datetime"
          onChange={noop}
          items={[
            { value: "text", label: "テキスト(1 行)" },
            { value: "datetime", label: "日時" },
          ]}
        />
        <TextField label="表示名" defaultValue="公開日" />
        <TextField label="API 名" defaultValue="published_at" isMonospace />
        <Checkbox isSelected onChange={noop} description="空のままでは保存できません">
          必須
        </Checkbox>
      </div>
    </SidePanel>
  </div>
);

export const BottomSheet = () => (
  <div style={screen}>
    <SidePanel
      isOpen
      onClose={noop}
      title="cover.png"
      width={360}
      narrowLayout="sheet"
      footer={
        <div style={footer}>
          <Button variant="dangerLink">ファイルを削除</Button>
        </div>
      }
    >
      <div style={form}>
        <TextField
          label="代替テキスト"
          defaultValue="秋のキャンペーンの表紙"
          description="画像の内容を短く説明します"
        />
        <TextField label="キャプション" placeholder="画像の下に表示する文" />
      </div>
    </SidePanel>
  </div>
);
