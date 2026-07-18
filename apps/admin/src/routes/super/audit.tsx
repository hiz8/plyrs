import { createFileRoute } from "@tanstack/react-router";

// Task 14 が実装する監査ログ画面の見出しのみのプレースホルダ。
export const Route = createFileRoute("/super/audit")({
  component: () => <h1>監査ログ</h1>,
});
