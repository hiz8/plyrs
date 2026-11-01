import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
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
          // spike(M0-3): wrangler.jsonc の ADMIN(逆向き Service Binding)は vitest では相手が
          // いないため起動に失敗する。スタブで埋める(逆向き binding を採る場合の運用コスト)
          serviceBindings: { ADMIN: async () => Response.json({ stub: true }) },
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_PROJECTION_MIGRATIONS: projectionMigrations,
            JWT_SECRET: "test-secret-do-not-use-in-prod-0123456789",
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
