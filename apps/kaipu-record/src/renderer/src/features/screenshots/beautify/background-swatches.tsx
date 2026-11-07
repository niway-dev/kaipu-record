import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { BACKGROUNDS, backgroundCss, type BackgroundId } from "./backgrounds";
import styles from "./background-swatches.module.css";

/**
 * The background presets as a grid of swatches: one button per `BACKGROUNDS` entry, named by
 * its `screenshots` i18n key. Shared by both editors, so the ids, the paints and the names
 * never diverge between the screenshot's Beautify panel and the video's Background section.
 */
export function BackgroundSwatches({
  value,
  onSelect,
  className,
}: {
  value: BackgroundId;
  onSelect: (id: BackgroundId) => void;
  /** Extra class for the grid (spacing is the caller's business). */
  className?: string;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  return (
    <div className={className ? `${styles.swatches} ${className}` : styles.swatches}>
      {BACKGROUNDS.map((bg) => (
        <button
          key={bg.id}
          type="button"
          title={t(bg.nameKey)}
          aria-label={t(bg.nameKey)}
          aria-pressed={value === bg.id}
          className={`${styles.swatch} ${value === bg.id ? styles.selected : ""}`}
          style={{ background: backgroundCss(bg.id) }}
          onClick={() => onSelect(bg.id)}
        />
      ))}
    </div>
  );
}
