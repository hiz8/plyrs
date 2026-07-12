import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, "../../packages/db/drizzle-d1"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            JWT_SECRET: "test-secret-do-not-use-in-prod",
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
