import { FileButton } from "@plyrs/ui";
import { Upload } from "lucide-react";

const row = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } as const;
const noop = () => {};

export const Variants = () => (
  <div style={row}>
    <FileButton onFiles={noop} variant="primary" icon={Upload}>
      ファイルを追加
    </FileButton>
    <FileButton onFiles={noop} variant="secondary" size="sm" allowsMultiple={false}>
      アップロード
    </FileButton>
    <FileButton onFiles={noop} variant="link" acceptedFileTypes={["image/png", "image/jpeg"]}>
      画像を選ぶ
    </FileButton>
  </div>
);

export const Disabled = () => (
  <div style={row}>
    <FileButton onFiles={noop} variant="primary" icon={Upload} isDisabled>
      ファイルを追加
    </FileButton>
  </div>
);
