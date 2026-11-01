import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 既定は node。DOM が要る試作だけファイル先頭の @vitest-environment jsdom で切り替え、
    // 「Worker(DOM 無し)で動く経路はどれか」を環境の違いとして記録する
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
