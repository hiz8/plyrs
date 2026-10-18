import { RelativeTime } from "@plyrs/ui";

const col = { display: "flex", flexDirection: "column", gap: 10 } as const;

export const Relative = () => (
  <RelativeTime value={{ text: "10 分前", absolute: "2026/10/17 10:00", iso: "2026-10-17T01:00:00Z" }} />
);

export const Absolute = () => (
  <RelativeTime value={{ text: "2026/09/01 14:30", absolute: "2026/09/01 14:30", iso: "2026-09-01T05:30:00Z" }} />
);

export const InList = () => (
  <div style={col}>
    <div>
      更新: <RelativeTime value={{ text: "3 時間前", absolute: "2026/10/17 08:00", iso: "2026-10-16T23:00:00Z" }} />
    </div>
    <div>
      作成: <RelativeTime value={{ text: "2026/08/20 09:15", absolute: "2026/08/20 09:15", iso: "2026-08-20T00:15:00Z" }} />
    </div>
  </div>
);
