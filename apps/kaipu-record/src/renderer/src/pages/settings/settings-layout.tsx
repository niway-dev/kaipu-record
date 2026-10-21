import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  AppWindow,
  Camera,
  Code,
  Folder,
  Monitor,
  Settings,
  SlidersHorizontal,
  Video,
} from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { cx } from "@renderer/ui/cx";
import styles from "./settings-layout.module.css";

type SettingsNavKey =
  | "general"
  | "permissions"
  | "recordingQuality"
  | "recording"
  | "screenshots"
  | "files"
  | "app"
  | "developer";

const NAV: ReadonlyArray<{ to: string; labelKey: SettingsNavKey; Icon: typeof Settings }> = [
  { to: "general", labelKey: "general", Icon: Settings },
  { to: "permissions", labelKey: "permissions", Icon: Monitor },
  { to: "recording-quality", labelKey: "recordingQuality", Icon: SlidersHorizontal },
  { to: "recording", labelKey: "recording", Icon: Video },
  { to: "screenshots", labelKey: "screenshots", Icon: Camera },
  { to: "files", labelKey: "files", Icon: Folder },
  { to: "app", labelKey: "app", Icon: AppWindow },
  // Dev-only page; `import.meta.env.DEV` is a build-time literal, so prod strips it.
  ...(import.meta.env.DEV ? [{ to: "developer", labelKey: "developer" as const, Icon: Code }] : []),
];

/**
 * Settings shell: a secondary nav on the left, the selected page on the right. Each page
 * surfaces only settings wired end to end (IPC + persistence); cloud account, save mode and
 * capacity live in their own rail section (/cloud), not here.
 */
export function SettingsLayout(): React.JSX.Element {
  const t = useTranslations("settings");
  return (
    <div className={styles.layout}>
      <nav className={styles.nav} aria-label={t("title")}>
        <h1 className={styles.navTitle}>{t("title")}</h1>
        <ul className={styles.navList}>
          {NAV.map(({ to, labelKey, Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) => cx(styles.navItem, isActive && styles.navItemActive)}
              >
                <Icon size={16} strokeWidth={1.8} aria-hidden />
                {t(labelKey)}
              </NavLink>
            </li>
          ))}
        </ul>
        <p className={styles.navNote}>{t("navCloudNote")}</p>
      </nav>
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}
