import { NavLink } from "react-router-dom";
import { Video, Library, Settings, User } from "lucide-react";
import { KaipuMark } from "./kaipu-mark";
import styles from "./sidebar.module.css";

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  [styles.navItem, isActive ? styles.active : ""].filter(Boolean).join(" ");

interface NavItem {
  to: string;
  label: string;
  Icon: typeof Video;
  end?: boolean;
}

// Record is the index route (`/`), so it uses `end` to avoid matching everything.
const NAV: NavItem[] = [
  { to: "/", label: "Record", Icon: Video, end: true },
  { to: "/library", label: "Library", Icon: Library },
  { to: "/settings", label: "Settings", Icon: Settings },
];

/**
 * Labeled navigation rail: the Kaipu mark up top, then icon + mono-label items
 * whose active state is a soft accent pill with an indicator bar on the rail
 * edge. Account avatar pinned to the footer.
 */
export function Sidebar(): React.JSX.Element {
  return (
    <nav className={styles.sidebar}>
      <div className={styles.brand} title="Kaipu Recorder">
        <KaipuMark size={24} />
      </div>

      <div className={styles.sections}>
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={linkClass} title={label}>
            <span className={styles.navBar} aria-hidden />
            <Icon size={19} strokeWidth={1.8} />
            <span className={styles.navLabel}>{label}</span>
          </NavLink>
        ))}
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.avatar} title="Account">
          <User size={16} strokeWidth={1.8} />
        </button>
      </div>
    </nav>
  );
}
