import React from "react";
import { Camera } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useScreenshotCapture } from "@renderer/features/screenshots/use-screenshot-capture";
import { RecentScreenshots } from "@renderer/features/screenshots/recent-screenshots";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { formatAccelerator } from "@renderer/features/shortcuts/keyboard-accelerator";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";
import styles from "./screenshots-page.module.css";

export function ScreenshotsPage(): React.JSX.Element {
  const t = useTranslations("screenshots");
  const { capture } = useScreenshotCapture();
  const labels = useShortcutLabels();
  return (
    <div className={styles.page}>
      <p className={styles.overline}>{t("overline")}</p>
      <h1 className={styles.title}>{t("pageTitle")}</h1>
      <p className={styles.subtitle}>{t("pageSubtitle")}</p>
      <div className={styles.card}>
        <button className={styles.capture} onClick={() => void capture()} type="button">
          <Camera size={20} /> {t("captureButton")}
        </button>
        <p className={styles.hint}>{t("captureHint")}</p>
        <span className={styles.shortcut}>
          {t("globalShortcut", {
            shortcut:
              labels?.captureScreenshot ??
              formatAccelerator(defaultShortcutsFor(window.electronAPI.platform).captureScreenshot),
          })}
        </span>
      </div>
      <RecentScreenshots />
    </div>
  );
}
