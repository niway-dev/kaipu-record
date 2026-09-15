import { Link } from "@tanstack/react-router";
import { useTranslations, useMessages } from "@kaipu/i18n";
import { LEGAL_CONTACT_EMAIL, type LegalDocumentId } from "./legal-config";
import { LegalLinks } from "./legal-links";
import styles from "./legal-page.module.css";

/** One legal document from the `legal` catalog, with its table of contents and contact block. */
export function LegalPage({ document }: { document: LegalDocumentId }) {
  const t = useTranslations("legal");
  const sections = useMessages().legal[document].sections as Record<
    string,
    { title: string; body: string }
  >;
  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back}>
          {t("home")} ↗
        </Link>
        <p className={styles.eyebrow}>{t("eyebrow")}</p>
        <h1>{t(`${document}.title`)}</h1>
        <p className={styles.intro}>{t(`${document}.intro`)}</p>
        <div className={styles.meta}>
          <p>{t("updated")}</p>
          <button type="button" onClick={() => window.print()}>
            {t("print")}
          </button>
        </div>
      </header>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <nav aria-label={t("contents")}>
            <h2>{t("contents")}</h2>
            <ol>
              {Object.entries(sections).map(([id, section]) => (
                <li key={id}>
                  <a href={`#${id}`}>{section.title}</a>
                </li>
              ))}
              <li>
                <a href="#contact">{t("contact")}</a>
              </li>
            </ol>
          </nav>
        </aside>
        <div className={styles.body}>
          {Object.entries(sections).map(([id, section], index) => (
            <section key={id} id={id}>
              <h2>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                {section.title}
              </h2>
              <p>{section.body}</p>
            </section>
          ))}
          <section id="contact" className={styles.contact}>
            <h2>{t("contact")}</h2>
            <p>{t("operator")}</p>
            <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
            <p>{t("contactBody")}</p>
          </section>
        </div>
      </div>
      <div className={styles.navigation}>
        <LegalLinks />
      </div>
    </article>
  );
}
