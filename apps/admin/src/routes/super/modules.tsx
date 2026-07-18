import { createFileRoute } from "@tanstack/react-router";

// Task 14 が実装するモジュール運用画面の見出しのみのプレースホルダ。
export const Route = createFileRoute("/super/modules")({
  component: () => <h1>モジュール</h1>,
});
