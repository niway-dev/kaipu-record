import React from "react";
import { Outlet } from "react-router-dom";
import { SHORTCUT_DEFINITIONS, type ShortcutAction } from "@shared/types";
import { useTranslations } from "@kaipu/i18n";
import { Sidebar } from "./sidebar";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { useAppVersion } from "./use-app-version";
import { useWindowPreset } from "./use-window-preset";
import { EnvBadge } from "./env-badge";
import styles from "./app-shell.module.css";

/** action → `shortcuts` namespace status-word keys for the status bar. */
const STATUS_KEY: Record<
  ShortcutAction,
  "statusStart" | "statusStop" | "statusShowApp" | "statusCapture"
> = {
  startRecording: "statusStart",
  stopRecording: "statusStop",
  bringToFront: "statusShowApp",
  captureScreenshot: "statusCapture",
};

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
  // Every screen under the shell wants the base window. Declared here rather
  // than in each page so a new page cannot forget and inherit whatever size the
  // last screen left behind — which is exactly how leaving the editor used to
  // strand the window at 1440x900.
  useWindowPreset("base");

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
          SHORTCUT_DEFINITIONS.map((def, i) => (
            <React.Fragment key={def.action}>
              {i > 0 && <span className={styles.statusDot}>·</span>}
              <span>
                <kbd>{shortcuts[def.action]}</kbd> {t(STATUS_KEY[def.action])}
              </span>
            </React.Fragment>
          ))}
        {version && <span className={styles.statusVersion}>v{version}</span>}
      </div>
    </div>
  );
}
