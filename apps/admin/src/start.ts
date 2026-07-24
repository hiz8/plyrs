import { createStart } from "@tanstack/react-start";

// workerd の SSR は相対 URL fetch を解決できないため、
// loader/beforeLoad をクライアント専用化する二次防御(主防御は server.ts のシェル配信)。
export const startInstance = createStart(() => ({
  defaultSsr: false,
}));
