import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest.config.ts は test.globals を有効化していないため、@testing-library/react の
// auto-cleanup（afterEach が global にある前提）が発火しない。明示的に登録する。
// 未クリーンアップだと複数 it() が render() する auth-flow.test.tsx で <html> が二重マウントされる。
afterEach(() => {
  cleanup();
});

// 14 ファイル並列実行時の CPU 競合で findBy*（既定 1 秒）が確率的に切れる。
// アサート内容ではなく待ち時間だけの問題なので、非同期ユーティリティの上限を広げる。
configure({ asyncUtilTimeout: 5_000 });
