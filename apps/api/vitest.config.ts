import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, "../../packages/db/drizzle-d1"));
  const projectionMigrations = await readD1Migrations(
    path.join(here, "../../packages/db/drizzle-projection"),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          r2Buckets: ["ASSETS"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_PROJECTION_MIGRATIONS: projectionMigrations,
            JWT_SECRET: "test-secret-do-not-use-in-prod",
            TURNSTILE_SECRET_KEY: "test-turnstile-secret",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts", "src/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
