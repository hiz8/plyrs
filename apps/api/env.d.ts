// 手元の @cloudflare/workers-types はグローバル Env を `cloudflare:workers` の
// `env` へ反映するのに ProvidedEnv ではなく Cloudflare.Env 名前空間のマージを使う
// （wrangler types が生成するコードと同じパターン）。自己参照を避けるため一段
// 中間インターフェースを挟む。
interface EnvBindings {
  TENANT_DO: DurableObjectNamespace<import("./src/tenant-do").TenantDO>;
}

declare namespace Cloudflare {
  interface Env extends EnvBindings {}
}

interface Env extends EnvBindings {}
