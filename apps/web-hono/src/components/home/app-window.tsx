import * as stylex from "@stylexjs/stylex";
import { useRouteContext } from "@tanstack/react-router";
import { Camera, Crop, Library, Mic, Monitor, Video, Volume2 } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";
import { DEFAULT_ACCELERATORS, formatAccelerator } from "@kaipu/domain/constants";
import { Rail, RecordButton, SourceCard, StatusToggleRow, type RailItem } from "@kaipu/ui";
import { lightTheme } from "@kaipu/tokens/kaipu.stylex";

import styles from "./app-window.module.css";

const noop = () => {};

/**
 * The hero's product shot: the Kaipu window in its "ready to record" state, with
 * the menu-bar card overlapping its corner.
 *
 * The window's content is the product's own components from `@kaipu/ui` — the
 * same rail, source card, toggles and record button the desktop renders — fed
 * the landing's labels. Only the frame (title bar, traffic lights) and the
 * menu-bar card are landing-local decoration.
 *
 * Nothing here is interactive: the window is `inert`, so the real buttons it
 * renders can never take focus or a click, and the whole thing is announced
 * once, by the figure that wraps it.
 */
export function AppWindow() {
  const t = useTranslations("landing");
  const nav = useTranslations("nav");
  const record = useTranslations("record");
  const { landingTheme } = useRouteContext({ from: "__root__" });
  // Read from the same record the desktop app registers, never typed by hand —
  // all three glyphs here were wrong before this existed.
  const keys = {
    record: formatAccelerator(DEFAULT_ACCELERATORS.mac.startRecording),
    screenshot: formatAccelerator(DEFAULT_ACCELERATORS.mac.captureScreenshot),
  };

  const railItems: RailItem[] = [
    {
      id: "record",
      label: nav("record"),
      icon: <Video size={19} strokeWidth={1.8} />,
      active: true,
    },
    {
      id: "screenshots",
      label: nav("screenshots"),
      icon: <Camera size={19} strokeWidth={1.8} />,
    },
    { id: "library", label: nav("library"), icon: <Library size={19} strokeWidth={1.8} /> },
  ];

  const toggles = [
    { id: "mic", icon: <Mic size={19} />, label: record("micLabel"), isActive: true },
    { id: "audio", icon: <Volume2 size={19} />, label: record("audioLabel"), isActive: true },
    { id: "camera", icon: <Camera size={19} />, label: record("cameraLabel"), isActive: false },
  ].map((toggle) => ({ ...toggle, onToggle: noop }));

  // The real components read the app's dark tokens by default; the landing's own
  // light mode takes the generated light theme, exactly as the desktop does.
  const theme = landingTheme === "light" ? stylex.props(lightTheme).className : undefined;

  return (
    <div className={styles.wrap}>
      <div className={[styles.window, "kl-window", theme].filter(Boolean).join(" ")}>
        <div className={styles.titlebar}>
          <div className={styles.lights}>
            <span className={`${styles.light} ${styles.red}`} />
            <span className={`${styles.light} ${styles.amber}`} />
            <span className={`${styles.light} ${styles.green}`} />
          </div>
          <span className={styles.windowTitle}>{t("homeAppTitle")}</span>
          <span />
        </div>

        <div className={styles.body} inert>
          <Rail
            brand={<KaipuLogo use="product" size={40} />}
            items={railItems}
            renderLink={(item, props) => <span data-rail-item={item.id} {...props} />}
          />

          <div className={styles.main}>
            <span className={styles.ready}>
              <span className={styles.readyDot} />
              {record("readyToRecord")}
            </span>

            <SourceCard
              icon={<Monitor size={19} />}
              name={t("homeAppDisplay")}
              meta={t("homeAppDisplayMeta")}
              actionLabel={record("change")}
              onAction={noop}
            />

            <StatusToggleRow items={toggles} onText={t("homeAppOn")} offText={t("homeAppOff")} />

            <RecordButton isRecording={false} shortcut={keys.record} onClick={noop}>
              {record("startRecordingBtn")}
            </RecordButton>
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
