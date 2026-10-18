import { Skeleton } from "@plyrs/ui";

const col = { display: "flex", flexDirection: "column", gap: 10, width: 360 } as const;

export const Text = () => (
  <div style={col}>
    <Skeleton shape="text" width="80%" />
    <Skeleton shape="text" width="60%" />
    <Skeleton shape="text" width="70%" />
  </div>
);

export const Shapes = () => (
  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
    <Skeleton shape="circle" width={40} height={40} />
    <Skeleton shape="block" width={160} height={96} />
    <div style={col}>
      <Skeleton shape="text" width={180} />
      <Skeleton shape="text" width={120} />
    </div>
  </div>
);
