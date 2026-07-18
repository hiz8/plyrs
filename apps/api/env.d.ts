// 手元の @cloudflare/workers-types はグローバル Env を `cloudflare:workers` の
// `env` へ反映するのに ProvidedEnv ではなく Cloudflare.Env 名前空間のマージを使う
// （wrangler types が生成するコードと同じパターン）。自己参照を避けるため一段
// 中間インターフェースを挟む。
interface EnvBindings {
  TENANT_DO: DurableObjectNamespace<import("./src/tenant-do").TenantDO>;
  DB: D1Database;
  // design-spec §12.2: 共有投影 D1（publish 派生の公開読み取りモデル）
  PROJECTION_DB: D1Database;
  // design-spec §12.3: アウトボックス排出先。DO からも Worker からも送る
  PROJECTION_QUEUE: Queue<import("./src/projection/jobs").ProjectionJob>;
  // Phase 9 §9.4: モジュールイベント(afterWrite/afterPublish)の排出先。DO からのみ送る
  MODULES_QUEUE: Queue<import("./src/modules/events").ModuleQueueJob>;
  BLOCKLIST: KVNamespace;
  // Phase 5b (G3): 公開 read の tenantSlug→tenantId 解決キャッシュ（公開経路は DO を起こさない）
  TENANT_SLUGS: KVNamespace;
  // Phase 8: アセットのバイナリ(R2)。メタデータは各テナント DO の asset record
  ASSETS: R2Bucket;
  // 本番: `wrangler secret put JWT_SECRET`。ローカル dev: .dev.vars。テスト: vitest.config の miniflare.bindings。
  // wrangler.jsonc の vars には置かない（公知値が本番デフォルトになる事故を防ぐ）。
  JWT_SECRET: string;
  // テスト専用: vitest.config の miniflare.bindings が注入する（本番には存在しない）
  TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  TEST_PROJECTION_MIGRATIONS: import("cloudflare:test").D1Migration[];
}

declare namespace Cloudflare {
  interface Env extends EnvBindings {}
}

interface Env extends EnvBindings {}
