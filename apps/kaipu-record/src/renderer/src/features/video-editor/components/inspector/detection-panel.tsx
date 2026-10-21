/**
 * Inspector with nothing selected (UI spec § 7.4): the single Sensitivity slider that
 * re-runs detection, a live summary and Re-analyse. Without a cursor track it explains
 * why there is nothing to detect instead of showing dead controls.
 */
import { RefreshCw } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { ZoomEditing } from "../../zoom/use-zoom-editing";
import { HistorySlider } from "../history-slider";
import styles from "./inspector.module.css";

export function DetectionPanel({
  zooms,
  sensitivity,
  clicksAvailable,
}: {
  zooms: ZoomEditing;
  sensitivity: number;
  /** False when the track has no clicks (macOS without Accessibility, or PR 2 only). */
  clicksAvailable: boolean;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  return (
    <section className={styles.panel} aria-label={t("detectionTitle")}>
      <h2 className={styles.title}>{t("detectionTitle")}</h2>
      {zooms.canDetect ? (
        <>
          <p className={styles.text}>{t("detectionBody")}</p>
          <HistorySlider
            label={t("sensitivityLabel")}
            value={sensitivity}
            min={0}
            max={100}
            step={1}
            note={t("sensitivityNote")}
            onBegin={zooms.begin}
            onLive={zooms.sensitivityLive}
            onEnd={zooms.end}
            onCommit={zooms.sensitivityCommit}
          />
          <p className={styles.summary}>
            {t("detectionSummary", {
              count: zooms.visibleZooms.length,
              percent: Math.round(zooms.coverage * 100),
            })}
          </p>
          <button type="button" className={styles.secondaryButton} onClick={zooms.reanalyse}>
            <RefreshCw size={14} />
            {t("reanalyse")}
          </button>
          {!clicksAvailable && <p className={styles.hint}>{t("clicksUnavailableHint")}</p>}
        </>
      ) : (
        <p className={styles.text}>{t("detectionNoTrack")}</p>
      )}
      <h3 className={styles.sectionLabel}>{t("selectionLabel")}</h3>
      <p className={styles.text}>{t("selectionHint")}</p>
      <p className={styles.note}>{t("exportSafetyNote")}</p>
    </section>
  );
}
