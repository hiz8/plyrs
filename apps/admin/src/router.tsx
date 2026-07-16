import { QueryClient } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export interface RouterContext {
  queryClient: QueryClient;
}

export function createAppContext(): RouterContext {
  return { queryClient: new QueryClient() };
}

export function getRouter(options?: { context?: RouterContext; history?: RouterHistory }) {
  return createRouter({
    routeTree,
    context: options?.context ?? createAppContext(),
    defaultPreload: "intent",
    ...(options?.history ? { history: options.history } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
