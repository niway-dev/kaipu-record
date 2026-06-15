import { Outlet } from "react-router-dom";
import { Sidebar } from "./sidebar";
import styles from "./app-shell.module.css";

/**
 * App layout: a fixed icon sidebar plus the active page rendered into <Outlet />,
 * with a keyboard-hint status bar at the bottom. Every page lives under this
 * shell (see app/router.tsx).
 */
export function AppShell(): React.JSX.Element {
  return (
    <div className={styles.shell}>
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
      <div className={styles.statusBar}>
        <span>
          <kbd>⌘R</kbd> record
        </span>
        <span className={styles.statusDot}>·</span>
        <span>
          <kbd>⌘L</kbd> library
        </span>
        <span className={styles.statusDot}>·</span>
        <span>
          <kbd>⌘,</kbd> settings
        </span>
      </div>
    </div>
  );
}
