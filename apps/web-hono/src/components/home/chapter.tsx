import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "@kaipu/i18n";

import { cssVars } from "./css-vars";
import styles from "./chapter.module.css";

interface ChapterProps {
  /** Anchor id and scroll-spy target — must match the slug in chapters.ts. */
  id: string;
  /** Token suffix for this chapter's tint: c1 … c4. */
  tint: "c1" | "c2" | "c3" | "c4";
  number: string;
  icon: LucideIcon;
  /** i18n key prefix, e.g. "homeChapter1". */
  keyPrefix: "homeChapter1" | "homeChapter2" | "homeChapter3" | "homeChapter4";
  /** The product mockup. Rendered inside a figure, announced once. */
  children: ReactNode;
}

/**
 * One numbered chapter: tinted icon, counter, label, headline + serif answer,
 * body, feature pills, and the mockup beside them.
 *
 * The tint reaches the glow, the icon gradient and its shadow as one variable,
 * so adding a fifth chapter is a row in chapters.ts and a tint token — not a
 * new stylesheet.
 */
export function Chapter({ id, tint, number, icon: Icon, keyPrefix, children }: ChapterProps) {
  const t = useTranslations("landing");
  // Literal indices, not a mapped range: `Pill${number}` widens to every integer
  // and stops matching a real message key, so a typo would slip through.
  const pills = ([1, 2, 3, 4] as const).map((n) => t(`${keyPrefix}Pill${n}`));

  return (
    <section
      id={id}
      className={styles.chapter}
      style={cssVars({
        "--kl-tint": `var(--kl-${tint})`,
        "--kl-tint-from": `var(--kl-${tint}-from)`,
        "--kl-tint-to": `var(--kl-${tint}-to)`,
      })}
    >
      <div className="kl-glow kl-glow-chapter" aria-hidden />

      <div className={styles.grid}>
        <div>
          <span className={`${styles.icon} kl-chapter-icon`} aria-hidden>
            <Icon size={26} />
          </span>

          <div className={styles.meta}>
            <span className={styles.counter}>
              {number} / {t("homeRailTotal")}
            </span>
            <span className={styles.label}>
              <span className={styles.labelStrong}>{t(`${keyPrefix}Label`)}</span>·{" "}
              {t(`${keyPrefix}Sub`)}
            </span>
          </div>

          <h2 className={styles.title}>
            {t(`${keyPrefix}Title`)}
            <span className={styles.serif}>{t(`${keyPrefix}Serif`)}</span>
          </h2>

          <p className={styles.body}>{t(`${keyPrefix}Body`)}</p>

          <div className={styles.pills}>
            {pills.map((pill) => (
              <span key={pill} className={styles.pill}>
                {pill}
              </span>
            ))}
          </div>
        </div>

        <figure className={`${styles.stage} kl-reveal`} data-kl-shown="true">
          {children}
        </figure>
      </div>
    </section>
  );
}
