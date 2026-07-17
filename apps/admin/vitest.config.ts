import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [stylex.vite()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // findBy の上限拡大（setup 参照)に合わせ、テスト自体のタイムアウトも余裕を持たせる
    testTimeout: 15_000,
  },
});
