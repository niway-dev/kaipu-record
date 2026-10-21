import { useTranslations } from "@kaipu/i18n";

import styles from "./moments.module.css";

/**
 * The turn from the hero to the chapters: one promise, in one breath. It used to
 * be a second full-screen opening with the four chapter chips; the rail and the
 * mobile chapter strip already list the chapters, and a page that introduces
 * itself twice reads slow. So this is a band, and the next section (Kai) is the
 * first thing that scrolls into view after the hero.
 */
export function Moments() {
  const t = useTranslations("landing");

  return (
    <section id="moments" className={`${styles.band} kl-dots`}>
      <div className={styles.inner}>
        <p className={styles.eyebrow}>{t("homeEyebrow")}</p>
        <h2 className={styles.title}>
          {t("homeMomentsLead")} <span className={styles.serif}>{t("homeMomentsSerif")}</span>
        </h2>
        <p className={styles.sub}>{t("homeMomentsSub")}</p>
      </div>
    </section>
  );
}
