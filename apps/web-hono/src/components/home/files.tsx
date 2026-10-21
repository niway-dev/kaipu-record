import { Check } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";

import { MockFinder } from "./mock-finder";
import { PixelGrid } from "./pixel-grid";
import { useReveal } from "./use-reveal";
import styles from "./files.module.css";

/**
 * The page's turn from what Kaipu does to what it will not do: your library is a
 * folder, the files are standard, and uninstalling changes nothing.
 */
export function Files() {
  const t = useTranslations("landing");
  const { ref, shown } = useReveal<HTMLElement>();
  const checks = [t("homeFilesCheck1"), t("homeFilesCheck2"), t("homeFilesCheck3")];

  return (
    <section id="files" className={`${styles.section} kl-dots`}>
      <PixelGrid className={styles.pixels} />

      <div className={styles.grid}>
        <div>
          <p className={styles.eyebrow}>{t("homeFilesEyebrow")}</p>
          <h2 className={styles.title}>{t("homeFilesTitle")}</h2>
          <p className={styles.body}>{t("homeFilesBody")}</p>

          <ul className={styles.checks}>
            {checks.map((check) => (
              <li key={check} className={styles.check}>
                <span className={styles.tick} aria-hidden>
                  <Check size={15} />
                </span>
                {check}
              </li>
            ))}
          </ul>
        </div>

        <figure ref={ref} className={`${styles.stage} kl-reveal`} data-kl-shown={shown}>
          <MockFinder />
        </figure>
      </div>
    </section>
  );
}
