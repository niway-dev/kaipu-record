import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";

import { useReveal } from "./use-reveal";
import styles from "./kai.module.css";

/**
 * Who Kai is, and where the name comes from — the page's third section, between
 * the moments band and chapter 01, so the character is met before he shows up
 * on camera in the recording illustration.
 *
 * The origin block reuses the `origin*` messages that the earlier home carried
 * in `BrandOrigin`: one etymology, one set of strings, as brand-identity.md
 * requires. Kai makes no product claim here beyond what the app does today —
 * the menu-bar mark reflects the selected recording or screenshot mode.
 */
export function Kai() {
  const t = useTranslations("landing");
  const { ref, shown } = useReveal<HTMLElement>();

  return (
    <section id="kai" className={`${styles.section} kl-dots`}>
      <div className={styles.grid}>
        {/* The figure reveals; the text does not, so a visitor without script
            still reads the section. */}
        <figure ref={ref} className={`${styles.stage} kl-reveal`} data-kl-shown={shown}>
          <KaipuLogo use="product" size={240} className={styles.fox} />
        </figure>

        <div>
          <h2 className={styles.title}>{t("homeKaiHeading")}</h2>
          <p className={styles.body}>{t("homeKaiBody")}</p>

          <div className={styles.origin}>
            <p className={styles.eyebrow}>{t("originHeading")}</p>
            <p className={styles.formula}>{t("originFormula")}</p>
            <dl className={styles.terms}>
              <div className={styles.term}>
                <dt className={styles.termName}>{t("originKayTerm")}</dt>
                <dd className={styles.termBody}>{t("originKayBody")}</dd>
              </div>
              <div className={styles.term}>
                <dt className={styles.termName}>{t("originKhipuTerm")}</dt>
                <dd className={styles.termBody}>{t("originKhipuBody")}</dd>
              </div>
            </dl>
            <p className={styles.originBody}>{t("originBody")}</p>
            <p className={styles.signature}>{t("originSignature")}</p>
            <p className={styles.note}>{t("originNote")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
