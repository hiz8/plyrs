// 手元の @cloudflare/workers-types はグローバル Env を `cloudflare:workers` の
// `env` へ反映するのに ProvidedEnv ではなく Cloudflare.Env 名前空間のマージを使う
// （wrangler types が生成するコードと同じパターン）。自己参照を避けるため一段
// 中間インターフェースを挟む。
interface EnvBindings {
  TENANT_DO: DurableObjectNamespace<import("./src/tenant-do").TenantDO>;
  DB: D1Database;
  BLOCKLIST: KVNamespace;
  JWT_SECRET: string;
  // テスト専用: vitest.config の miniflare.bindings が注入する（本番には存在しない）
  TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
}

declare namespace Cloudflare {
  interface Env extends EnvBindings {}
}

interface Env extends EnvBindings {}
