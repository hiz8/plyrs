import { DropZone } from "@plyrs/ui";

const wrap = { width: 480 } as const;
const noop = () => {};

export const Default = () => (
  <div style={wrap}>
    <DropZone
      onFiles={noop}
      acceptedFileTypes={["image/png", "image/jpeg", "application/pdf"]}
      allowsMultiple
      title="ファイルをここにドロップ"
      description="画像・PDF、1 ファイル 20 MB まで"
      buttonLabel="ファイルを選択"
    />
  </div>
);

export const Disabled = () => (
  <div style={wrap}>
    <DropZone
      onFiles={noop}
      title="ファイルをここにドロップ"
      description="接続が切れているためアップロードできません"
      buttonLabel="ファイルを選択"
      isDisabled
    />
  </div>
);
