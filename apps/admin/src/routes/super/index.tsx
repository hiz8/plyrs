import { createFileRoute } from "@tanstack/react-router";

// Task 13 が実装するテナント一覧の見出しのみのプレースホルダ。
export const Route = createFileRoute("/super/")({
  component: () => <h1>テナント</h1>,
});
