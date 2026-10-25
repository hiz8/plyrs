import { UploadTile } from "@plyrs/ui";

// 一覧のグリッドと同じ列幅(160px)に並べて 5 つの状態を見せる
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, 160px)", gap: 12 } as const;
const smallGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, 140px)", gap: 12 } as const;
const noop = () => {};

export const States = () => (
  <div style={grid}>
    <UploadTile name="photo-01.jpg" state={{ kind: "queued" }} />
    <UploadTile name="photo-02.jpg" state={{ kind: "uploading" }} />
    <UploadTile
      name="photo-03.jpg"
      state={{ kind: "uploading", progress: 0.64, detail: "64% ・ 1.2 MB / 1.9 MB" }}
    />
    <UploadTile
      name="report.pdf"
      state={{ kind: "failed", message: "アップロードできませんでした", onRetry: noop }}
    />
    <UploadTile
      name="movie.mov"
      state={{
        kind: "rejected",
        message: "ファイルが大きすぎます",
        detail: "24.8 MB",
        onRemove: noop,
      }}
    />
    <UploadTile name="photo-04.jpg" state={{ kind: "done" }} />
  </div>
);

export const Small = () => (
  <div style={smallGrid}>
    <UploadTile name="photo-05.jpg" size="sm" state={{ kind: "uploading", progress: 0.3, detail: "30% ・ 0.6 MB / 2.0 MB" }} />
    <UploadTile name="photo-06.jpg" size="sm" state={{ kind: "done" }} />
  </div>
);
