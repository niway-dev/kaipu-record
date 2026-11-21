import { Crop, Video } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";

import { useOnScreen } from "@/components/demos/use-on-screen";
import { useReducedMotion } from "@/components/demos/use-reduced-motion";
import styles from "./capture-widget-mock.module.css";

/**
 * The Capture chapter's picture: the desktop capture widget (Screenshot P / Recording V,
 * Frame / Screen, Free ratio, Copy, Esc, Capture) docked under a pink dashed selection
 * frame. Rebuilt as a light web mock, with the visual language of
 * apps/kaipu-record/src/renderer/src/features/screenshots/overlay/capture-widget.tsx.
 *
 * One 12 s loop of CSS keyframes: Screenshot with a Frame, then Screen (the frame grows to
 * the whole display), then the toggle flips to Recording and the button reads Record, then
 * back. It pauses while off screen and holds its first frame under reduced motion.
 *
 * It is a picture, not an interface: nothing in it is focusable, and the figure carries
 * one label for assistive tech.
 */
export function CaptureWidgetMock() {
  const t = useTranslations("landing");
  const reducedMotion = useReducedMotion();
  const { ref, onScreen } = useOnScreen<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={styles.stage}
      data-static={reducedMotion ? "" : undefined}
      data-paused={!reducedMotion && !onScreen ? "" : undefined}
      role="img"
      aria-label={t("homeWidgetLabel")}
    >
      <div className={styles.screen} aria-hidden>
        <div className={styles.chrome}>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </div>
        <div className={styles.page}>
          <span className={`${styles.line} ${styles.lineWide}`} />
          <span className={styles.line} />
          <div className={styles.cards}>
            <span className={styles.card} />
            <span className={styles.card} />
            <span className={styles.card} />
          </div>
          <span className={styles.line} />
        </div>
        <div className={styles.frame}>
          <span className={styles.readout}>
            <span className={styles.readoutA}>1280 × 720</span>
            <span className={styles.readoutB}>2560 × 1440</span>
          </span>
        </div>
      </div>

      <div className={styles.widget} aria-hidden>
        <div className={styles.group}>
          <span className={`${styles.seg} ${styles.pressShot}`}>
            <Crop size={14} />
            {t("homeWidgetScreenshot")}
            <kbd className={styles.kbd}>P</kbd>
          </span>
          <span className={`${styles.seg} ${styles.pressRec}`}>
            <Video size={14} />
            {t("homeWidgetRecording")}
            <kbd className={styles.kbd}>V</kbd>
          </span>
        </div>
        <span className={styles.divider} />
        <div className={styles.group}>
          <span className={`${styles.seg} ${styles.pressFrame}`}>{t("homeWidgetFrame")}</span>
          <span className={`${styles.seg} ${styles.pressScreen}`}>{t("homeWidgetScreen")}</span>
        </div>
        <span className={styles.chip}>
          {t("homeWidgetFree")}
          <span className={styles.caret}>▾</span>
        </span>
        <span className={styles.divider} />
        <span className={`${styles.seg} ${styles.optional}`}>
          {t("homeWidgetCopy")}
          <kbd className={styles.kbd}>⌘C</kbd>
        </span>
        <span className={`${styles.seg} ${styles.optional}`}>
          <kbd className={styles.kbd}>Esc</kbd>
        </span>
        <span className={styles.go}>
          <span className={styles.goLabelA}>{t("homeWidgetCapture")}</span>
          <span className={styles.goLabelB}>
            <span className={styles.rec} />
            {t("homeWidgetRecord")}
          </span>
        </span>
      </div>
    </div>
  );
}
