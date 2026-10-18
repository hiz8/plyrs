import { TextField } from "@plyrs/ui";

const col = { display: "flex", flexDirection: "column", gap: 16, width: 360 } as const;

export const Default = () => (
  <div style={col}>
    <TextField label="タイトル" placeholder="タイトルを入力" isRequired />
  </div>
);

export const WithDescription = () => (
  <div style={col}>
    <TextField
      label="スラッグ"
      defaultValue="nenmatsu-nenshi"
      description="半角の英数字とハイフンだけが使えます。例: nenmatsu-nenshi"
      isMonospace
    />
  </div>
);

export const Invalid = () => (
  <div style={col}>
    <TextField label="タイトル" isRequired isInvalid errorMessage="タイトルを入力してください" />
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <TextField label="API で使う名前" defaultValue="news" isDisabled />
  </div>
);
