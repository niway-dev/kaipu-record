import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { SHORTCUT_DEFINITIONS, type ShortcutAction } from "@shared/types";
import { useTranslations } from "@kaipu/i18n";
import { Sidebar } from "./sidebar";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { useAppVersion } from "./use-app-version";
import { useWindowPreset } from "./use-window-preset";
import { presetForPath } from "@shared/window-size";
import { EnvBadge } from "./env-badge";
import styles from "./app-shell.module.css";

/**
 * action → `shortcuts` namespace status-word keys for the status bar. The live
 * input toggles are left out on purpose: seven hints would crowd the bar, and
 * the Shortcuts page lists every binding.
 */
const STATUS_KEY: Partial<
  Record<ShortcutAction, "statusStart" | "statusStop" | "statusShowApp" | "statusCapture">
> = {
  startRecording: "statusStart",
  stopRecording: "statusStop",
  bringToFront: "statusShowApp",
  captureScreenshot: "statusCapture",
};
const STATUS_BAR_DEFINITIONS = SHORTCUT_DEFINITIONS.filter((def) => STATUS_KEY[def.action]);

/**
 * Main app layout: a fixed icon sidebar plus the active page rendered into <Outlet />,
 * sized by the base window preset — the full-window editors declare their own.
 * with a status bar showing the real (global, rebindable) recording shortcuts.
 * Every sidebar page lives under this shell; the always-on behaviour (hotkeys,
 * banners, the version gate) lives one level up in AppRoot so full-window pages
 * outside the shell keep it (see app/router.tsx).
 */
export function AppShell(): React.JSX.Element {
  const t = useTranslations("shortcuts");
  const shortcuts = useShortcutLabels();
  const version = useAppVersion();
  // Resolved from the route on every navigation, not asked for on each page's
  // mount. The pages mount and unmount under this shell, which does not, so a
  // page that grew the window on mount had nothing to shrink it back when the
  // user navigated away — the editor stranded the window at 1440x900.
  useWindowPreset(presetForPath(useLocation().pathname));

  return (
    <div className={styles.shell}>
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
      <div className={styles.statusBar}>
        <EnvBadge className={styles.statusEnv} />
        {shortcuts &&
          STATUS_BAR_DEFINITIONS.map((def, i) => (
            <React.Fragment key={def.action}>
              {i > 0 && <span className={styles.statusDot}>·</span>}
              <span>
                <kbd>{shortcuts[def.action]}</kbd> {t(STATUS_KEY[def.action]!)}
              </span>
            </React.Fragment>
          ))}
        {version && <span className={styles.statusVersion}>v{version}</span>}
      </div>
    </div>
  );
}
