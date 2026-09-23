/** Inspector for a selected blur region (UI spec § 7.2). */
import { Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { RedactionEditing } from "../../privacy/use-redaction-editing";
import { type BlurRedaction, REDACTION } from "../../privacy/redaction";
import { HistorySlider } from "../history-slider";
import { formatPrecise } from "./format";
import styles from "./inspector.module.css";

export function BlurInspector({
  redaction,
  range,
  edits,
  onRemoved,
}: {
  redaction: BlurRedaction;
  /** Timeline range of the region's visible pieces. */
  range: { from: number; to: number };
  edits: RedactionEditing;
  onRemoved(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  return (
    <section className={styles.panel} aria-label={t("blurTitle")}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("blurTitle")}</h2>
        <span className={styles.badgeBlur}>{t("blurBadge")}</span>
      </header>
      <p className={styles.range}>
        {formatPrecise(range.from)} → {formatPrecise(range.to)}
      </p>
      <HistorySlider
        label={t("blurIntensity")}
        value={redaction.intensity}
        min={REDACTION.minIntensity}
        max={100}
        step={1}
        note={t("blurIntensityNote")}
        onBegin={edits.begin}
        onLive={(intensity) => edits.livePatch(redaction.id, { intensity })}
        onEnd={edits.end}
        onCommit={(intensity) => edits.commitPatch(redaction.id, { intensity })}
      />
      <div className={styles.segmented} role="group" aria-label={t("blurStyle")}>
        {(["gaussian", "pixelate"] as const).map((style) => (
          <button
            key={style}
            type="button"
            aria-pressed={redaction.style === style}
            className={redaction.style === style ? styles.segmentActive : styles.segment}
            onClick={() => edits.commitPatch(redaction.id, { style })}
          >
            {style === "gaussian" ? t("blurGaussian") : t("blurPixelate")}
          </button>
        ))}
      </div>
      <p className={styles.note}>{t("blurSecretNote")}</p>
      <p className={styles.noteInfo}>{t("privacyPinnedNote")}</p>
      <button
        type="button"
        className={styles.dangerButton}
        onClick={() => {
          edits.remove(redaction.id);
          onRemoved();
        }}
      >
        <Trash2 size={14} />
        {t("removeRegion")}
      </button>
    </section>
  );
}
