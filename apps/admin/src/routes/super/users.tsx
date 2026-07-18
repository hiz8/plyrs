import { createFileRoute } from "@tanstack/react-router";

// Task 14 が実装するユーザー管理の見出しのみのプレースホルダ。
export const Route = createFileRoute("/super/users")({
  component: () => <h1>ユーザー</h1>,
});
