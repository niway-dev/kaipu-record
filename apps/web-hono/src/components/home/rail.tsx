import { Crop, Folder, Scissors, Search, Video } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { KaipuLogo } from "@kaipu/brand";

import { CHAPTERS, type ChapterId } from "./chapters";
import { cssVars } from "./css-vars";
import { useActiveChapter } from "./use-active-chapter";
import styles from "./rail.module.css";

const ICONS: Record<Exclude<ChapterId, "hero">, typeof Video> = {
  record: Video,
  capture: Crop,
  edit: Scissors,
  find: Search,
  files: Folder,
};

/**
 * The fixed chapter rail. It is the page's only navigation — the old marketing
 * top bar is gone from the home route.
 *
 * Buttons rather than anchors: these scroll the current page, they do not
 * navigate, and a button is what a screen reader should announce. The anchor
 * ids still exist on the sections, so a pasted `#record` link works.
 */
export function Rail() {
  const t = useTranslations("landing");
  const active = useActiveChapter();
  const activeChapter = CHAPTERS.find((c) => c.id === active);

  const scrollTo = (slug: string): void => {
    document.getElementById(slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className={`${styles.rail} kl-glass`} aria-label={t("homeEyebrow")}>
      {/* The active chapter's number, or a dash on the bookends. */}
      <span className={styles.count} aria-hidden>
        {activeChapter?.number ?? "–"}
      </span>
      <span className={styles.tick} aria-hidden />

      {CHAPTERS.map((chapter) => {
        const isActive = chapter.id === active;
        const label = t(chapter.labelKey);
        const Icon = chapter.id === "hero" ? null : ICONS[chapter.id];
        return (
          <button
            key={chapter.id}
            type="button"
            className={`${styles.item} ${isActive ? styles.itemActive : ""}`}
            style={chapter.tint ? cssVars({ "--kl-tint": `var(--kl-${chapter.tint})` }) : undefined}
            aria-current={isActive ? "true" : undefined}
            onClick={() => scrollTo(chapter.slug)}
          >
            {Icon ? <Icon size={17} aria-hidden /> : <KaipuLogo use="product" size={26} />}
            {/*
              The name is drawn only while this button is hovered or focused.
              The previous version drew it permanently beside the ACTIVE icon,
              which put a box reading "Kaipu" on top of the app mockup's
              "Change" button on the very first screen. On hover it is the
              reader's own doing, it is transient, and it answers the question
              for any chapter rather than only the one you are already in.
            */}
            <span className={styles.label} aria-hidden>
              {label}
            </span>
            <span className="kl-sr-only">{label}</span>
          </button>
        );
      })}

      <span className={styles.tick} aria-hidden />
      <span className={styles.count} aria-hidden>
        {t("homeRailTotal")}
      </span>
    </nav>
  );
}
