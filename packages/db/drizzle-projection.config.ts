import { defineConfig } from "drizzle-kit";

// 投影 D1（共有・publish 派生）用。generate 専用 — 適用はテストの applyD1Migrations /
// 本番の `wrangler d1 migrations apply`。
export default defineConfig({
  out: "./drizzle-projection",
  schema: "./src/projection.ts",
  dialect: "sqlite",
});
