import { Apple, ArrowUpRight, Mail, Monitor, Play } from "lucide-react";
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
            {/*
              Two primaries, swapped by CSS rather than by JS. On a phone the
              visitor is not on the Mac they would install on, so offering a
              .dmg is a dead end — the useful action is mailing the link to the
              machine that can run it. Both are rendered server-side and one is
              hidden, which avoids the flash a client-side width check gives.
            */}
            <a href={downloadUrls.macArm64} className={`${styles.ctaPrimary} ${styles.deskOnly}`}>
              <Apple size={18} aria-hidden />
              {t("homeHeroCtaPrimary")}
              <ArrowUpRight size={17} aria-hidden />
            </a>
            <a href="#download" className={`${styles.ctaPrimary} ${styles.mobileOnly}`}>
              <Mail size={17} aria-hidden />
              {t("homeHeroCtaMobile")}
            </a>
            <a href="#record" className={styles.ctaSecondary}>
              <Play size={15} aria-hidden />
              {t("homeHeroCtaSecondary")}
            </a>
          </div>

          <p className={`${styles.footnote} ${styles.deskOnly}`}>{t("homeHeroFootnote")}</p>
          <p className={`${styles.mobileNote} ${styles.mobileOnly}`}>
            <Monitor size={14} aria-hidden />
            {t("homeHeroMobileNote")}
          </p>
        </div>

        <figure style={{ margin: 0 }} aria-label={t("homeAppTitle")}>
          <AppWindow />
        </figure>
      </div>
    </section>
  );
}
