import { Camera, Crop, Library, Mic, Monitor, Video, Volume2 } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";
import { DEFAULT_ACCELERATORS, formatAccelerator } from "@kaipu/domain/constants";

import styles from "./app-window.module.css";

/**
 * The hero's product shot: the Kaipu window in its "ready to record" state, with
 * the menu-bar card overlapping its corner.
 *
 * Presentational only — nothing here is interactive, so it carries no buttons a
 * keyboard could land on and no labels a screen reader should read out. The
 * whole thing is announced once, by the figure that wraps it.
 */
export function AppWindow() {
  const t = useTranslations("landing");
  // Read from the same record the desktop app registers, never typed by hand —
  // all three glyphs here were wrong before this existed.
  const keys = {
    record: formatAccelerator(DEFAULT_ACCELERATORS.mac.startRecording),
    screenshot: formatAccelerator(DEFAULT_ACCELERATORS.mac.captureScreenshot),
  };

  const sources = [
    { icon: Mic, label: t("homeAppMic"), on: true },
    { icon: Volume2, label: t("homeAppAudio"), on: true },
    { icon: Camera, label: t("homeAppCamera"), on: false },
  ];

  return (
    <div className={styles.wrap}>
      <div className={`${styles.window} kl-window`}>
        <div className={styles.titlebar}>
          <div className={styles.lights}>
            <span className={`${styles.light} ${styles.red}`} />
            <span className={`${styles.light} ${styles.amber}`} />
            <span className={`${styles.light} ${styles.green}`} />
          </div>
          <span className={styles.windowTitle}>{t("homeAppTitle")}</span>
          <span />
        </div>

        <div className={styles.body}>
          <div className={styles.sidebar}>
            <KaipuLogo use="product" size={26} />
            <span className={`${styles.sideItem} ${styles.sideActive}`}>
              <Video size={18} />
            </span>
            <span className={styles.sideItem}>
              <Camera size={18} />
            </span>
            <span className={styles.sideItem}>
              <Library size={18} />
            </span>
          </div>

          <div className={styles.main}>
            <span className={styles.ready}>
              <span className={styles.readyDot} />
              {t("homeAppReady")}
            </span>

            <div className={styles.display}>
              <span className={styles.displayIcon}>
                <Monitor size={19} />
              </span>
              <span className={styles.displayText}>
                <span className={styles.displayName}>{t("homeAppDisplay")}</span>
                <span className={styles.displayMeta}>{t("homeAppDisplayMeta")}</span>
              </span>
              <span className={styles.changeBtn}>{t("homeAppChange")}</span>
            </div>

            <div className={styles.sources}>
              {sources.map(({ icon: Icon, label, on }) => (
                <span key={label} className={`${styles.source} ${on ? styles.sourceOn : ""}`}>
                  <Icon size={19} />
                  <span className={styles.sourceLabel}>{label}</span>
                  <span className={styles.sourceState}>
                    {on ? t("homeAppOn") : t("homeAppOff")}
                  </span>
                </span>
              ))}
            </div>

            <div className={styles.start}>
              <span className={styles.startInner}>
                <span className={styles.readyDot} style={{ background: "#fff" }} />
                {t("homeAppStart")}
                <span className={styles.startShortcut}>{keys.record}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* The menu bar, always one shortcut away — the point the section is making. */}
      <div className={`${styles.tray} kl-float-card`}>
        <div className={styles.trayHead}>
          {t("homeTrayAlways")}
          <KaipuLogo use="product" size={15} className={styles.trayClock} />
          <span className={styles.trayClock}>{t("homeTrayClock")}</span>
        </div>
        <div className={`${styles.trayRow} ${styles.trayRowActive}`}>
          <span className={styles.trayDot} />
          {t("homeTrayStart")}
          <span className={styles.trayKeys}>{keys.record}</span>
        </div>
        <div className={styles.trayRow}>
          <Crop size={15} />
          {t("homeTrayShot")}
          <span className={styles.trayKeys}>{keys.screenshot}</span>
        </div>
        <div className={styles.trayRow}>
          <Library size={15} />
          {t("homeTrayLibrary")}
        </div>
      </div>
    </div>
  );
}
