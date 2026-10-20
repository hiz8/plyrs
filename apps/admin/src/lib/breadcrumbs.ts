import type { BreadcrumbItem } from "@plyrs/ui";
import { NAV_LABELS, TERMS } from "./labels";

export const homeCrumb = (slug: string): BreadcrumbItem => ({
  id: "home",
  label: NAV_LABELS.home,
  href: `/t/${slug}`,
});

export const contentTypeCrumb = (
  slug: string,
  type: { key: string; name: string },
): BreadcrumbItem => ({
  id: `type:${type.key}`,
  label: type.name,
  href: `/t/${slug}/content/${type.key}`,
});

export const mediaCrumb = (slug: string): BreadcrumbItem => ({
  id: "media",
  label: NAV_LABELS.media,
  href: `/t/${slug}/media`,
});

export const settingsCrumb = (slug: string): BreadcrumbItem => ({
  id: "settings",
  label: NAV_LABELS.settings,
  href: `/t/${slug}/settings/general`,
});

export const settingsContentTypesCrumb = (slug: string): BreadcrumbItem => ({
  id: "settings-content-types",
  label: TERMS.contentType,
  href: `/t/${slug}/settings/content-types`,
});

// 現在地は href を持たない(リンクにしない)。
export const currentCrumb = (label: string): BreadcrumbItem => ({ id: "current", label });
