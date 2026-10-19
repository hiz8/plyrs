import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { RouterContext } from "../router";
import { THEME_BOOT_SCRIPT } from "../lib/theme";
import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "plyrs admin" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // dev では StyleX の CSS がバンドルに入らず、unplugin の dev エンドポイントから取る
      // (@stylexjs/unplugin README "Dev HTML injection")。build では prerender に入れない
    ],
    scripts: import.meta.env.DEV
      ? [{ type: "module", children: "import('virtual:stylex:runtime')" }]
      : [],
  }),
  shellComponent: RootShell,
  component: RootComponent,
});

function RootShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <head>
        {/* h-design-tokens.md 4 章: 記憶したテーマを描画より前に当てる(prerender で /_shell に入る) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
        {/* dev では StyleX の CSS がバンドルに入らず、unplugin の dev エンドポイントから取る
            (@stylexjs/unplugin README "Dev HTML injection")。build の prerender には入れない。
            head() の links に置くと React 19 が stylesheet の読み込み完了まで描画を保留し、
            jsdom のテストが止まるので、precedence の無い素の link としてシェルに置く */}
        {import.meta.env.DEV ? <link rel="stylesheet" href="/virtual:stylex.css" /> : null}
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
