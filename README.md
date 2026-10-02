# plyrs

Cloudflare 上で動くマルチテナント CMS/BaaS。コンテンツの型をデータとして定義でき、管理画面はローカルファースト同期で編集し、公開側はヘッドレス API で配信する。

## 構成

| パス                     | 内容                                                  |
| ------------------------ | ----------------------------------------------------- |
| `apps/api`               | API Worker(Hono)。テナント DO・Queues consumer を含む |
| `apps/admin`             | 管理画面(TanStack Start)                              |
| `apps/e2e`               | E2E テスト(Playwright)                                |
| `packages/metamodel`     | 型定義・バリデーション                                |
| `packages/sync-protocol` | 同期メッセージと競合解決                              |
| `packages/sync-client`   | 同期クライアント                                      |
| `packages/db`            | Drizzle スキーマとマイグレーション                    |
| `packages/ui`            | UI コンポーネント                                     |

## 開発

前提: Node.js 24 以上、pnpm 10

```bash
pnpm install
pnpm --filter @plyrs/admin dev   # 管理画面 + API をローカル起動
```

ローカル起動の前に `apps/api/.dev.vars` に `JWT_SECRET`(32 字以上)を設定する。`apps/admin/.dev.vars` は `.dev.vars.example` を参照。

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm test                        # 単体テスト
pnpm --filter @plyrs/e2e test    # E2E
```

## ドキュメント

- [設計仕様](docs/design-spec.md)
- [技術選定](docs/tech-selection.md)
- [デプロイ手順](docs/deploy.md)
