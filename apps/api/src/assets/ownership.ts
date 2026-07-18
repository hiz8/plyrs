// 最終レビュー指摘(important, merge blocker): r2_key は record.data 経由の値であり、常には
// サーバー生成を保証されない。assetGuardHook は contentType.source === "system" のときしか
// 働かないため、Phase 8 以前から key='asset' のユーザー型を持つテナント(ensure-asset-type.ts の
// 分岐: 自動登録を断念して既存機能を守るケース)では、クライアントが任意の r2_key を書き込める
// ―― record.type は変わらず 'asset' のままなので、プレビュー/公開配信/削除の各ルートは通ってしまう。
// ASSETS.get/delete へ r2_key を渡す前に、必ずこの述語で呼び出し元テナントの領域
// (`${tenantId}/` 接頭辞)に属することを確認する。
export function assetKeyBelongsToTenant(r2Key: string, tenantId: string): boolean {
  return r2Key.startsWith(`${tenantId}/`);
}
