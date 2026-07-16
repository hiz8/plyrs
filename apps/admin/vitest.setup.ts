import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest.config.ts は test.globals を有効化していないため、@testing-library/react の
// auto-cleanup（afterEach が global にある前提）が発火しない。明示的に登録する。
// 未クリーンアップだと複数 it() が render() する auth-flow.test.tsx で <html> が二重マウントされる。
afterEach(() => {
  cleanup();
});
