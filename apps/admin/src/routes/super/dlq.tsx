import { createFileRoute } from "@tanstack/react-router";

// Task 14 が実装する DLQ 運用画面の見出しのみのプレースホルダ。
export const Route = createFileRoute("/super/dlq")({
  component: () => <h1>DLQ</h1>,
});
