import { ProgressBar } from "@plyrs/ui";

const col = { display: "flex", flexDirection: "column", gap: 16, width: 360 } as const;

export const Accent = () => (
  <div style={col}>
    <ProgressBar label="メディアをアップロード中" value={3} maxValue={8} valueLabel="3 / 8 件" />
  </div>
);

export const Success = () => (
  <div style={col}>
    <ProgressBar label="インポート完了" value={120} maxValue={120} valueLabel="120 / 120 件" tone="success" />
  </div>
);

export const Stages = () => (
  <div style={col}>
    <ProgressBar label="開始直後" value={5} maxValue={100} valueLabel="5%" />
    <ProgressBar label="半分" value={50} valueLabel="50%" />
    <ProgressBar label="あと少し" value={92} valueLabel="92%" />
  </div>
);
