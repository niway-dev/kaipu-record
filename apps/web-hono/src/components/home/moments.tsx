import { Crop, Scissors, Search, Video } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";

import { NUMBERED } from "./chapters";
import { cssVars } from "./css-vars";
import styles from "./moments.module.css";

const CHIP_ICONS = [Video, Crop, Scissors, Search];

/**
 * The chapters' opening spread: the promise, and the page's table of contents.
 * It follows the hero rather than being it — the hero says what Kaipu is, this
 * says how the rest of the page is organised.
 */
export function Moments() {
  const t = useTranslations("landing");

  return (
    <section id="moments" className={`${styles.hero} kl-dots`}>
      <div className="kl-glow kl-glow-hero" aria-hidden />
      <span className={styles.glyph} aria-hidden>
        REC
      </span>

      <div className={styles.inner}>
        <p className={styles.eyebrow}>{t("homeEyebrow")}</p>
        <h1 className={styles.title}>
          {t("homeMomentsLead")} <span className={styles.serif}>{t("homeMomentsSerif")}</span>
        </h1>
        <p className={styles.sub}>{t("homeMomentsSub")}</p>

        <div className={styles.chips}>
          {NUMBERED.map((chapter, i) => {
            const Icon = CHIP_ICONS[i]!;
            return (
              <a
                key={chapter.id}
                href={`#${chapter.slug}`}
                className={styles.chip}
                style={cssVars({
                  "--kl-tint": `var(--kl-${chapter.tint})`,
                  "--kl-tint-from": `var(--kl-${chapter.tint}-from)`,
                  "--kl-tint-to": `var(--kl-${chapter.tint}-to)`,
                })}
              >
                <span className={styles.chipDot} aria-hidden>
                  <Icon size={15} />
                </span>
                <span className={styles.chipNum} aria-hidden>
                  {chapter.number}
                </span>
                {t(chapter.labelKey)}
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
