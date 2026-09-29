import { Crop, Scissors, Search, Video } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";

import { NUMBERED } from "./chapters";
import { useActiveChapter } from "./use-active-chapter";
import { cssVars } from "./css-vars";
import styles from "./chapter-strip.module.css";

const ICONS = [Video, Crop, Scissors, Search];

/**
 * The mobile counterpart of the rail: the same four chapters, laid out
 * horizontally under the top bar. Rendered on every viewport and hidden by CSS
 * above 980px, so both forms read from one `useActiveChapter` and cannot
 * disagree about which chapter is current.
 *
 * It shares the rail's landmark name deliberately. Two navigation landmarks with
 * the same name would be a defect if both were exposed, but `display: none`
 * removes an element from the accessibility tree, so exactly one exists at any
 * viewport — and it should be called the same thing either way.
 */
export function ChapterStrip() {
  const t = useTranslations("landing");
  const active = useActiveChapter();

  return (
    <nav className={`${styles.strip} kl-glass`} aria-label={t("homeEyebrow")}>
      {NUMBERED.map((chapter, i) => {
        const Icon = ICONS[i]!;
        const isActive = chapter.id === active;
        return (
          <a
            key={chapter.id}
            href={`#${chapter.slug}`}
            className={`${styles.item} ${isActive ? styles.itemActive : ""}`}
            aria-current={isActive ? "true" : undefined}
            style={cssVars({
              "--kl-tint": `var(--kl-${chapter.tint})`,
              "--kl-tint-from": `var(--kl-${chapter.tint}-from)`,
              "--kl-tint-to": `var(--kl-${chapter.tint}-to)`,
            })}
          >
            <span className={styles.dot} aria-hidden>
              <Icon size={14} />
            </span>
            {t(chapter.labelKey)}
          </a>
        );
      })}
    </nav>
  );
}
