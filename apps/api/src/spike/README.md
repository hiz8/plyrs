# M0-3 試作: 認可サーバー(OAuth 2.1)と PAT の検証経路

`spike/mcp-oauth` ブランチだけに置く試作。main には取り込まない(結果は
`docs/superpowers/plans/2026-11-01-m0-3-oauth-spike-result.md`)。

## 構成

- `mcp-auth-server.ts` — `@cloudflare/workers-oauth-provider` v1 の分割 API を、テナント別の issuer
  (`https://admin.example/oauth/t/<tenantId>`)と resource(`https://api.example/mcp/t/<tenantId>`)で
  要求ごとに組み立てる
- `pat.ts` — PAT の発行と検証(D1、`memberships` を join してロールを引く)
- `mcp-gate.ts` — PAT と OAuth を同じ認可コンテキスト `{userId, role, tenantId, exp, scopes, tokenId, via}` に
  合流させ、BLOCKLIST を両方に適用する
- `../../test/oauth-spike.test.ts` — 評価テストと遅延計測
- `../index.ts` の `/v1/_spike/admin-ping` と `wrangler.jsonc` の `services.ADMIN` — api → admin の逆向き
  Service Binding が dev(auxiliary worker)で成立するかの確認用

## 実行

```bash
export PATH="/opt/node24/bin:$PATH"   # Node 24
pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 --reporter=verbose test/oauth-spike.test.ts

# 逆向き Service Binding の確認(apps/api/.dev.vars と apps/admin/.dev.vars が必要)
pnpm --filter @plyrs/admin dev
curl http://127.0.0.1:5173/v1/_spike/admin-ping   # → {"status":200,"body":{"publicApiOrigin":""}}
```
