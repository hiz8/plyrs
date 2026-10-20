import * as stylex from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { Tabs } from "@plyrs/ui";
import { space } from "@plyrs/ui/semantic.stylex";
import { currentCrumb, homeCrumb, settingsCrumb } from "../../lib/breadcrumbs";
import { SETTINGS_LABELS } from "../../lib/labels";
import { PageBody, TenantPageHeader } from "../tenant-page-header";
import { CardError, CardLoading } from "./card-state";

export type SettingsTab = "general" | "content-types" | "members" | "modules";

export const SETTINGS_MAX_WIDTH = "880px";

const TAB_TO = {
  general: "/t/$tenantSlug/settings/general",
  "content-types": "/t/$tenantSlug/settings/content-types",
  members: "/t/$tenantSlug/settings/members",
  modules: "/t/$tenantSlug/settings/modules",
} as const satisfies Record<SettingsTab, string>;

const TAB_ORDER: readonly SettingsTab[] = ["general", "content-types", "members", "modules"];

// タブを選ぶとルートが変わり枠が作り直されるため、選んだタブを次の枠へ引き継いでフォーカスを戻す
let pendingTabFocus: SettingsTab | null = null;

const styles = stylex.create({
  frame: { display: "contents" },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    maxWidth: SETTINGS_MAX_WIDTH,
    paddingTop: space.lg,
  },
});

export function SettingsFrame({
  tab,
  slug,
  primaryAction,
  isLoading,
  error,
  children,
}: {
  tab: SettingsTab;
  slug: string;
  primaryAction?: ReactNode;
  isLoading?: boolean;
  error?: { message: string; onRetry: () => void };
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const labels = SETTINGS_LABELS;
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = frameRef.current;
    if (pendingTabFocus !== tab || container === null) return;
    // RAC のタブは collection の構築後に DOM へ出るため、現れるまで待ってからフォーカスする
    const focusSelected = () => {
      const el = container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (el === null) return false;
      el.focus();
      // 成功してから消す(StrictMode の effect 再実行でも取りこぼさない)
      pendingTabFocus = null;
      return true;
    };
    if (focusSelected()) return;
    const observer = new MutationObserver(() => {
      if (focusSelected()) observer.disconnect();
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [tab]);
  let body: ReactNode = children;
  if (error !== undefined) {
    body = <CardError message={error.message} onRetry={error.onRetry} />;
  } else if (isLoading === true) {
    body = <CardLoading />;
  }
  return (
    <>
      <TenantPageHeader
        title={labels.title}
        breadcrumbs={[homeCrumb(slug), settingsCrumb(slug), currentCrumb(labels.tabs[tab])]}
        primaryAction={primaryAction}
      />
      <PageBody>
        <div ref={frameRef} {...stylex.props(styles.frame)}>
          <Tabs
            label={labels.tabsName}
            items={TAB_ORDER.map((id) => ({ id, label: labels.tabs[id] }))}
            selectedKey={tab}
            // 矢印キーでは移るだけ。選ぶと URL が変わりフォーカスが外れるため、Enter / Space で決める
            keyboardActivation="manual"
            onSelectionChange={(id) => {
              pendingTabFocus = id as SettingsTab;
              void navigate({ to: TAB_TO[id as SettingsTab], params: { tenantSlug: slug } });
            }}
          >
            {(id) =>
              id === tab ? (
                <div
                  aria-busy={isLoading === true ? true : undefined}
                  {...stylex.props(styles.content)}
                >
                  {body}
                </div>
              ) : null
            }
          </Tabs>
        </div>
      </PageBody>
    </>
  );
}
