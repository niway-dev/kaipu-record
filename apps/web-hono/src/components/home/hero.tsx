import { Apple, ArrowUpRight, Play } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";

import { downloadUrls } from "@/lib/download";
import { AppWindow } from "./app-window";
import styles from "./hero.module.css";

/** The page's opening: what Kaipu is, and the app itself sitting next to it. */
export function Hero() {
  const t = useTranslations("landing");
  const pills = [t("homeHeroPill1"), t("homeHeroPill2"), t("homeHeroPill3"), t("homeHeroPill4")];

  return (
    <section id="top" className={`${styles.hero} kl-dots`}>
      <div className="kl-glow kl-glow-hero" aria-hidden />
      <span className={`${styles.glyph} ${styles.glyphTimer}`} aria-hidden>
        00:14
      </span>
      <span className={`${styles.glyph} ${styles.glyphKeys}`} aria-hidden>
        ⌘⇧P
      </span>
      <span className={`${styles.glyph} ${styles.glyphRec}`} aria-hidden>
        REC
      </span>

      <div className={styles.grid}>
        <div>
          <KaipuLogo use="app" size={72} className={styles.logoTile} />
          <p className={styles.eyebrow}>{t("homeHeroEyebrow")}</p>
          <p className={styles.badge}>
            <Apple size={14} aria-hidden />
            <span className={styles.badgeStrong}>{t("homeHeroBadgeMac")}</span> ·{" "}
            {t("homeHeroBadgeRest")}
          </p>

          <h1 className={styles.title}>
            {t("homeHeroTitle")}
            <span className={styles.serif}>{t("homeHeroSerif")}</span>
          </h1>

          <p className={styles.body}>{t("homeHeroBody")}</p>

          <div className={styles.pills}>
            {pills.map((pill) => (
              <span key={pill} className={styles.pill}>
                {pill}
              </span>
            ))}
          </div>

          <div className={styles.ctas}>
            <a href={downloadUrls.macArm64} className={styles.ctaPrimary}>
              <Apple size={18} aria-hidden />
              {t("homeHeroCtaPrimary")}
              <ArrowUpRight size={17} aria-hidden />
            </a>
            <a href="#record" className={styles.ctaSecondary}>
              <Play size={15} aria-hidden />
              {t("homeHeroCtaSecondary")}
            </a>
          </div>

          <p className={styles.footnote}>{t("homeHeroFootnote")}</p>
        </div>

        <figure style={{ margin: 0 }} aria-label={t("homeAppTitle")}>
          <AppWindow />
        </figure>
      </div>
    </section>
  );
}
