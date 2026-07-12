import { defineConfig } from "drizzle-kit";

// D1（コントロールプレーン）用。generate 専用 — 適用はテストの applyD1Migrations /
// 本番の `wrangler d1 migrations apply`。接続を要する push/migrate は使わないため
// driver / dbCredentials は不要。
export default defineConfig({
  out: "./drizzle-d1",
  schema: "./src/control-plane.ts",
  dialect: "sqlite",
});
