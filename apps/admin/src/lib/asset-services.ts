import type { AdminApi } from "./admin-api";

// アセットのプレビューは認証付き /v1 経路でしか取れない(<img src> は Authorization ヘッダを
// 付けられない)ため、blob を fetch して objectURL に変換する。record-form / asset 一覧 /
// エディタの画像ノードが同じキャッシュを共有する。
// objectURL は revoke しない(SPA のテナントセッション寿命でのリークは有限と判断。
// テナント切替でサービスごと作り直される)。
export interface AssetServices {
  upload: (file: File) => Promise<{ id: string }>;
  resolveUrl: (assetId: string) => Promise<string | null>;
}

export function createAssetServices(
  adminApi: AdminApi,
  tenantId: string,
  // テスト用 DI: jsdom には URL.createObjectURL が無い
  createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): AssetServices {
  const urls = new Map<string, Promise<string | null>>();
  return {
    upload: (file) => adminApi.uploadAsset(tenantId, file),
    resolveUrl: (assetId) => {
      const cached = urls.get(assetId);
      if (cached !== undefined) {
        return cached;
      }
      const promise = adminApi
        .fetchAssetBlob(tenantId, assetId)
        .then((blob) => createUrl(blob))
        .catch(() => null);
      urls.set(assetId, promise);
      return promise;
    },
  };
}
