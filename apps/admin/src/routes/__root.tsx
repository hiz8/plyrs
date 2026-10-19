import { QueryClientProvider } from "@tanstack/react-query";
import { ToastRegion } from "@plyrs/ui";
import { bg, font, text } from "@plyrs/ui/semantic.stylex";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { I18nProvider, RouterProvider as RacRouterProvider } from "react-aria-components";
import type { ReactNode } from "react";
import type { RouterContext } from "../router";
import { THEME_BOOT_SCRIPT } from "../lib/theme";
import appCss from "../styles.css?url";

const styles = stylex.create({
  body: {
    margin: 0,
    fontFamily: font.family,
    fontSize: font.body,
    lineHeight: font.lineHeightNormal,
    color: text.default,
    backgroundColor: bg.canvas,
  },
});

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
      <body {...stylex.props(styles.body)}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  return (
    <QueryClientProvider client={queryClient}>
      {/* h-common-surface.md 5 章: RAC の内部文言(表の全選択など)を日本語に固定する */}
      <I18nProvider locale="ja-JP">
        {/* RAC の Link / Breadcrumbs の href を TanStack Router の画面内遷移につなぐ */}
        <RacRouterProvider
          navigate={(href) => void router.navigate({ href })}
          useHref={(href) => href}
        >
          <Outlet />
          {/* h-common-surface.md 3 章: トーストの置き場はシェルに 1 か所 */}
          <ToastRegion />
        </RacRouterProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
