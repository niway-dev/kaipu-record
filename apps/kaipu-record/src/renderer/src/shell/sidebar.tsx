import { useEffect } from "react";
import { NavLink, matchPath, useLocation } from "react-router-dom";
import { Video, Library, Camera, Keyboard, Settings, User, Cloud, PenLine } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { KaipuLogo } from "@kaipu/brand";
import { Rail, type RailItem } from "@kaipu/ui";
import { ROUTES } from "@shared/routes";
import { useExportRunner } from "@renderer/features/video-editor/export/export-runner";
import {
  announceReadyCopies,
  libraryBadgeCount,
  markCopySeen,
  useReadyCopies,
} from "@renderer/features/video-editor/export/ready-copies";

interface NavItem {
  to: string;
  labelKey: "record" | "screenshots" | "editor" | "library" | "shortcuts" | "settings" | "cloud";
  Icon: typeof Video;
  end?: boolean;
}

interface LinkItem extends RailItem {
  to: string;
  end?: boolean;
}

// Record is the index route (`/`), so it uses `end` to avoid matching everything.
const NAV: NavItem[] = [
  { to: ROUTES.record, labelKey: "record", Icon: Video, end: true },
  { to: ROUTES.screenshots, labelKey: "screenshots", Icon: Camera },
  // Active on every /editor/* URL (not `end`), so an open item keeps it lit.
  { to: ROUTES.editor, labelKey: "editor", Icon: PenLine },
  { to: ROUTES.library, labelKey: "library", Icon: Library },
  { to: ROUTES.shortcuts, labelKey: "shortcuts", Icon: Keyboard },
  { to: ROUTES.settings, labelKey: "settings", Icon: Settings },
  { to: ROUTES.cloud, labelKey: "cloud", Icon: Cloud },
];

/**
 * The desktop's navigation rail: the shared `Rail`, fed react-router's NavLink,
 * lucide icons and translated labels. The rail itself knows none of those.
 */
export function Sidebar(): React.JSX.Element {
  const t = useTranslations("nav");
  const tCopy = useTranslations("backgroundCopy");
  const { pathname } = useLocation();
  const isActive = (to: string, end?: boolean): boolean =>
    matchPath({ path: to, end: end ?? false }, pathname) !== null;
  const libraryBadge = useLibraryBadge(pathname);

  const items: LinkItem[] = NAV.map(({ to, labelKey, Icon, end }) => ({
    id: to,
    to,
    end,
    label: t(labelKey),
    icon: <Icon size={19} strokeWidth={1.8} />,
    active: isActive(to, end),
    ...(to === ROUTES.library && libraryBadge > 0
      ? { badge: libraryBadge, badgeLabel: tCopy("libraryBadge", { count: libraryBadge }) }
      : {}),
  }));

  // The account lives on the Cloud page.
  const account: LinkItem = {
    id: "account",
    to: ROUTES.cloud,
    label: t("account"),
    icon: <User size={16} strokeWidth={1.8} />,
    active: isActive(ROUTES.cloud),
  };

  return (
    <Rail
      brand={<KaipuLogo use="product" size={40} />}
      brandTitle="Kaipu Record"
      items={items}
      account={account}
      renderLink={(item, props) => <NavLink to={item.to} end={item.end} {...props} />}
    />
  );
}

/**
 * The Library item's count of finished copies the user has not been shown (NIW2-586): one
 * finished while its ready card was hidden, or after the card was closed. Opening the Library
 * clears the count (the page points at the copies); opening a copy's page forgets that copy.
 * The rail is on every page, so this is where the route is watched.
 */
export function useLibraryBadge(pathname: string): number {
  const copies = useReadyCopies();
  const { ready } = useExportRunner();
  useEffect(() => {
    const detail = matchPath(ROUTES.libraryDetail, pathname);
    if (detail?.params.assetId) markCopySeen(detail.params.assetId);
    if (matchPath({ path: ROUTES.library, end: true }, pathname)) announceReadyCopies();
  }, [pathname, copies]);
  return libraryBadgeCount(copies, ready?.recording.assetId ?? null);
}
