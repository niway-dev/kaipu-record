import { ArrowRight, Plus } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { LibraryDestination, PlacementPreview } from "../add-from-library";
import styles from "./placement-strip.module.css";

/** A moved block shows its arrow only when it is at least this share of the strip wide. */
const MIN_ARROW_SHARE = 0.05;

export interface PlacementStripProps {
  preview: PlacementPreview;
  /** "large" labels the new block and marks moved clips; "small" is the menu's thumbnail. */
  size: "large" | "small";
  /** The text on the new block ("New · 3:12"); large only. */
  newLabel?: string;
}

/**
 * A mini timeline of the REAL sequence after an add (NIW2-829): proportional blocks, the new
 * item in accent at the place it would land, a small arrow on the clips it pushes later and the
 * playhead as a line with a flag. "Over the video" draws the item in a thin row above the clips,
 * from the playhead, and nothing moves. A drawing only: the sentence next to it is the text.
 */
export function PlacementStrip({
  preview,
  size,
  newLabel,
}: PlacementStripProps): React.JSX.Element {
  const large = size === "large";
  const total = Math.max(preview.total, Number.EPSILON);
  const percent = (seconds: number): string => `${(seconds / total) * 100}%`;
  return (
    <div className={`${styles.strip} ${large ? styles.large : styles.small}`} aria-hidden>
      {large && (
        <>
          <span className={`${styles.track} ${styles.trackTop}`} />
          <span className={`${styles.track} ${styles.trackMain}`} />
        </>
      )}
      {preview.blocks.map((block) => {
        const share = (block.end - block.start) / total;
        return (
          <span
            key={block.key}
            className={`${styles.slot} ${styles.main}`}
            style={{ left: percent(block.start), width: percent(block.end - block.start) }}
          >
            <span
              className={`${styles.block} ${block.isNew ? styles.fresh : styles.clip}`}
              data-testid="placement-block"
              data-new={block.isNew ? "true" : undefined}
              data-moved={block.moved ? "true" : undefined}
            >
              {large && block.isNew && (
                <>
                  <Plus size={11} strokeWidth={2.6} />
                  <span className={styles.newLabel}>{newLabel}</span>
                </>
              )}
              {large && block.moved && share >= MIN_ARROW_SHARE && (
                <ArrowRight className={styles.moved} size={12} strokeWidth={2.4} />
              )}
            </span>
          </span>
        );
      })}
      {preview.floating && (
        <span
          className={`${styles.slot} ${styles.top}`}
          style={{
            left: percent(preview.floating.start),
            width: percent(preview.floating.end - preview.floating.start),
          }}
        >
          <span
            className={`${styles.block} ${styles.fresh}`}
            data-testid="placement-block"
            data-new="true"
          >
            {large && <span className={styles.floatLabel}>{newLabel}</span>}
          </span>
        </span>
      )}
      {large && (
        <span className={styles.playhead} style={{ left: percent(preview.playhead) }}>
          <span className={styles.flag} />
        </span>
      )}
    </div>
  );
}

export interface PlacementCardProps {
  preview: PlacementPreview;
  destination: LibraryDestination;
  /** Writes a length in seconds the way the item shows it: "3:12" for a recording, "5 s" for an image. */
  formatLength(seconds: number): string;
}

/**
 * The card above the Add button: what the placement looks like, and one sentence that says
 * it with numbers from the same preview. The sentence is the accessible text of the drawing.
 */
export function PlacementCard({
  preview,
  destination,
  formatLength,
}: PlacementCardProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const fresh = preview.floating ?? preview.blocks.find((block) => block.isNew);
  const length = fresh ? fresh.end - fresh.start : 0;
  const duration = formatLength(length);
  const sentence = {
    over: () => t("addFromLibrarySentenceOver", { duration }),
    "before-clip": () => t("addFromLibrarySentenceBefore", { count: preview.moved, duration }),
    "after-clip": () => t("addFromLibrarySentenceAfter", { count: preview.moved, duration }),
    start: () => t("addFromLibrarySentenceStart", { count: preview.moved, duration }),
    end: () => t("addFromLibrarySentenceEnd"),
  }[destination]();
  return (
    <div className={styles.card} data-testid="placement-strip">
      <div className={styles.head}>
        <span className={styles.label}>{t("addFromLibraryPlacementLabel")}</span>
        <span className={styles.legend}>
          <span className={`${styles.swatch} ${styles.swatchNew}`} aria-hidden />
          {t("addFromLibraryLegendNew")}
          <span className={`${styles.swatch} ${styles.swatchClips}`} aria-hidden />
          {t("addFromLibraryLegendClips")}
        </span>
      </div>
      <PlacementStrip
        preview={preview}
        size="large"
        newLabel={t("addFromLibraryNewBlock", { duration })}
      />
      <p className={styles.sentence} data-testid="placement-sentence">
        {sentence}
      </p>
    </div>
  );
}
