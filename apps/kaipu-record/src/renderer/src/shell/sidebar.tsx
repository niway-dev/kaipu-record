import { useEffect, useRef } from "react";
import { Link, matchPath, useLocation } from "react-router-dom";
import { Focus, Library, Keyboard, Settings, User, Cloud, PenLine, Upload } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { Rail, type RailItem } from "@kaipu/ui";
import { ROUTES } from "@shared/routes";
import { useExportRunner } from "@renderer/features/video-editor/export/export-runner";
import {
  announceReadyCopies,
  libraryBadgeCount,
  markCopySeen,
  retireReadyCards,
  useReadyCopies,
} from "@renderer/features/video-editor/export/ready-copies";
import { uiArea } from "@renderer/lib/ui-area";

interface NavItem {
  to: string;
  labelKey: "capture" | "editor" | "export" | "library" | "shortcuts" | "settings" | "cloud";
  Icon: typeof Focus;
  end?: boolean;
}

interface LinkItem extends RailItem {
  to: string;
}

// Capture is the index route (`/`), so it uses `end` to avoid matching everything.
// Record and Screenshot used to be two entries; both live on this page now.
const NAV: NavItem[] = [
  { to: ROUTES.record, labelKey: "capture", Icon: Focus, end: true },
  // Active on every /editor/* URL (not `end`), so an open item keeps it lit.
  { to: ROUTES.editor, labelKey: "editor", Icon: PenLine },
  // Active on /export and /export/:assetId. Export also re-encodes videos Kaipu did not
  // record (imported files), so it needs its own entry, not only the editor's button.
  { to: ROUTES.exportNew, labelKey: "export", Icon: Upload },
  { to: ROUTES.library, labelKey: "library", Icon: Library },
  { to: ROUTES.shortcuts, labelKey: "shortcuts", Icon: Keyboard },
  { to: ROUTES.settings, labelKey: "settings", Icon: Settings },
  { to: ROUTES.cloud, labelKey: "cloud", Icon: Cloud },
];

/**
 * The desktop's navigation rail: the shared `Rail`, fed react-router's Link,
 * lucide icons and translated labels. The rail itself knows none of those.
 * Icons only: each label is the link's accessible name and shows in a tooltip.
 */
export function Sidebar(): React.JSX.Element {
  const t = useTranslations("nav");
  const tExport = useTranslations("export");
  const { pathname } = useLocation();
  const isActive = (to: string, end?: boolean): boolean =>
    matchPath({ path: to, end: end ?? false }, pathname) !== null;
  const exportBadge = useExportBadge(pathname);

  const items: LinkItem[] = NAV.map(({ to, labelKey, Icon, end }) => ({
    id: to,
    to,
    label: t(labelKey),
    icon: <Icon size={19} strokeWidth={1.8} />,
    active: isActive(to, end),
    ...(to === ROUTES.library && exportBadge > 0
      ? { badge: exportBadge, badgeLabel: tExport("railBadge", { count: exportBadge }) }
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

  // `Rail` (@kaipu/ui) forwards no props to its DOM, so the area root is this wrapper;
  // `display: contents` keeps it out of the layout (the catalog crops its `nav` child).
  return (
    <div {...uiArea("shell.sidebar")} style={{ display: "contents" }}>
      <Rail
        // No brand row: the logo and the name live in the title bar (NIW2-621).
        items={items}
        account={account}
        // Always icons only, the label in a tooltip on hover and focus (owner decision, NIW2-626).
        mode="collapsed"
        // Link, not NavLink: the rail already computed `active`.
        renderLink={(item, props) => <Link to={item.to} {...props} />}
      />
    </div>
  );
}

/**
 * The Library item's count (the copies Export makes end up there): the copy being made right now, plus finished copies the user has
 * not been shown (NIW2-586) — one that finished while its ready card was hidden, or after the
 * card was closed. Opening Export or the Library clears the finished ones (both point at the
 * copies); opening a copy's page forgets that copy. Leaving the Library retires the "Ready to
 * upload" cards it had on screen. The rail is on every page, so this is where the route
 * is watched.
 */
export function useExportBadge(pathname: string): number {
  const copies = useReadyCopies();
  const { ready, status } = useExportRunner();
  const wasOnLibrary = useRef(false);
  useEffect(() => {
    const detail = matchPath(ROUTES.libraryDetail, pathname);
    if (detail?.params.assetId) markCopySeen(detail.params.assetId);
    const onExport = matchPath({ path: ROUTES.exportNew, end: false }, pathname) !== null;
    const onLibrary = matchPath({ path: ROUTES.library, end: true }, pathname) !== null;
    if (onExport || onLibrary) announceReadyCopies();
    // A route watch rather than the page's unmount, which StrictMode runs on every mount.
    if (wasOnLibrary.current && !onLibrary) retireReadyCards();
    wasOnLibrary.current = onLibrary;
  }, [pathname, copies]);
  const running = status === "exporting" ? 1 : 0;
  return running + libraryBadgeCount(copies, ready?.recording.assetId ?? null);
}
