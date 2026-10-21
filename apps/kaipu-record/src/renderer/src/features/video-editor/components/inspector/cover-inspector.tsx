/** Inspector for a selected cover region (UI spec § 7.3). */
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { RedactionEditing } from "../../privacy/use-redaction-editing";
import { type CoverRedaction, REDACTION } from "../../privacy/redaction";
import { formatPrecise } from "./format";
import styles from "./inspector.module.css";

export function CoverInspector({
  redaction,
  range,
  edits,
  onRemoved,
}: {
  redaction: CoverRedaction;
  range: { from: number; to: number };
  edits: RedactionEditing;
  onRemoved(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  // The label is edited locally and committed once (blur / Enter) — one undo step per edit,
  // not one per keystroke.
  const [label, setLabel] = useState(redaction.label);
  useEffect(() => setLabel(redaction.label), [redaction.id, redaction.label]);
  const commitLabel = (): void => {
    if (label !== redaction.label) edits.commitPatch(redaction.id, { label });
  };

  return (
    <section className={styles.panel} aria-label={t("coverTitle")}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("coverTitle")}</h2>
        <span className={styles.badge}>{t("coverBadge")}</span>
      </header>
      <p className={styles.range}>
        {formatPrecise(range.from)} → {formatPrecise(range.to)}
      </p>
      <div className={styles.field}>
        <span>{t("coverFill")}</span>
        <div className={styles.swatches}>
          {REDACTION.coverFills.map((fill) => (
            <button
              key={fill}
              type="button"
              aria-label={fill}
              aria-pressed={redaction.fill === fill}
              className={redaction.fill === fill ? styles.swatchActive : styles.swatch}
              style={{ background: fill }}
              onClick={() => edits.commitPatch(redaction.id, { fill })}
            />
          ))}
        </div>
      </div>
      <label className={styles.field}>
        <span>{t("coverLabel")}</span>
        <input
          className={styles.fieldInput}
          value={label}
          maxLength={60}
          placeholder={t("coverLabelPlaceholder")}
          onChange={(event) => setLabel(event.currentTarget.value)}
          onBlur={commitLabel}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </label>
      <p className={styles.note}>{t("coverBurnNote")}</p>
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
