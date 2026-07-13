import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// setup はテストファイルごとのストレージ分離の外で複数回走りうるが、
// applyD1Migrations は未適用分だけを適用するため冪等で安全。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await applyD1Migrations(env.PROJECTION_DB, env.TEST_PROJECTION_MIGRATIONS);
