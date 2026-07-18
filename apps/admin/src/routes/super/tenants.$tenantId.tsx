import { createFileRoute } from "@tanstack/react-router";

// Task 13 が実装するテナント詳細画面の見出しのみのプレースホルダ。
export const Route = createFileRoute("/super/tenants/$tenantId")({
  component: () => <h1>テナント詳細</h1>,
});
