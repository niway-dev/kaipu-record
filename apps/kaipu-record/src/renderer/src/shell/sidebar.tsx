import { NavLink, matchPath, useLocation } from "react-router-dom";
import { Video, Library, Camera, Keyboard, Settings, User, Cloud } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { KaipuLogo } from "@kaipu/brand";
import { Rail, type RailItem } from "@kaipu/ui";
import { ROUTES } from "@shared/routes";

interface NavItem {
  to: string;
  labelKey: "record" | "screenshots" | "library" | "shortcuts" | "settings" | "cloud";
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
  const { pathname } = useLocation();
  const isActive = (to: string, end?: boolean): boolean =>
    matchPath({ path: to, end: end ?? false }, pathname) !== null;

  const items: LinkItem[] = NAV.map(({ to, labelKey, Icon, end }) => ({
    id: to,
    to,
    end,
    label: t(labelKey),
    icon: <Icon size={19} strokeWidth={1.8} />,
    active: isActive(to, end),
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
