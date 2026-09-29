import { Crop, Scissors, Search, Video } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";

import { NUMBERED } from "./chapters";
import { cssVars } from "./css-vars";
import styles from "./hero.module.css";

const CHIP_ICONS = [Video, Crop, Scissors, Search];

/** Section 00 — the promise, and the page's table of contents. */
export function Hero() {
  const t = useTranslations("landing");

  return (
    <section id="top" className={`${styles.hero} kl-dots`}>
      <div className="kl-glow kl-glow-hero" aria-hidden />
      <span className={styles.glyph} aria-hidden>
        REC
      </span>

      <div className={styles.inner}>
        <p className={styles.eyebrow}>{t("homeEyebrow")}</p>
        <h1 className={styles.title}>
          {t("homeHeroLead")} <span className={styles.serif}>{t("homeHeroSerif")}</span>
        </h1>
        <p className={styles.sub}>{t("homeHeroSub")}</p>

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
