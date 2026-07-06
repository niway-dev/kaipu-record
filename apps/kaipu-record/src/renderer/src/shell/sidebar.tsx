import { NavLink } from "react-router-dom";
import { Video, Library, Camera, Keyboard, Settings, User } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { KaipuMark } from "./kaipu-mark";
import { cx } from "@renderer/ui/cx";
import styles from "./sidebar.module.css";

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  cx(styles.navItem, isActive && styles.active);

interface NavItem {
  to: string;
  labelKey: "record" | "screenshots" | "library" | "shortcuts" | "settings";
  Icon: typeof Video;
  end?: boolean;
}

// Record is the index route (`/`), so it uses `end` to avoid matching everything.
const NAV: NavItem[] = [
  { to: "/", labelKey: "record", Icon: Video, end: true },
  { to: "/screenshots", labelKey: "screenshots", Icon: Camera },
  { to: "/library", labelKey: "library", Icon: Library },
  { to: "/shortcuts", labelKey: "shortcuts", Icon: Keyboard },
  { to: "/settings", labelKey: "settings", Icon: Settings },
];

/**
 * Labeled navigation rail: the Kaipu mark up top, then icon + mono-label items
 * whose active state is a soft accent pill with an indicator bar on the rail
 * edge. Account avatar pinned to the footer.
 */
export function Sidebar(): React.JSX.Element {
  const t = useTranslations("nav");
  return (
    <nav className={styles.sidebar}>
      <div className={styles.brand} title="Kaipu Record">
        <KaipuMark size={24} />
      </div>

      <div className={styles.sections}>
        {NAV.map(({ to, labelKey, Icon, end }) => {
          const label = t(labelKey);
          return (
            <NavLink key={to} to={to} end={end} className={linkClass} title={label}>
              <span className={styles.navBar} aria-hidden />
              <Icon size={19} strokeWidth={1.8} />
              <span className={styles.navLabel}>{label}</span>
            </NavLink>
          );
        })}
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.avatar} title={t("account")}>
          <User size={16} strokeWidth={1.8} />
        </button>
      </div>
    </nav>
  );
}
