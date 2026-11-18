import { ArrowRight, Plus } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  condensePlacement,
  type LibraryDestination,
  type PlacementPreview,
} from "../add-from-library";
import styles from "./placement-strip.module.css";

/** A moved block shows its arrow only when it is at least this share of the strip wide. */
const MIN_ARROW_SHARE = 0.05;
/** Past this share of the width, the "You are here" chip sits left of the playhead line. */
const CHIP_FLIP_SHARE = 0.75;

export interface PlacementStripProps {
  preview: PlacementPreview;
  /**
   * "large" is the card's strip: the real sequence condensed, with labels and the "You are here"
   * chip. "small" is the menu's thumbnail: every block of `preview`, no text.
   */
  size: "large" | "small";
  /** The text on the new block ("New · 3:12"); large only. */
  newLabel?: string;
}

/**
 * A mini timeline of an add (NIW2-829): blocks, the new item in accent at the place it would
 * land, a small arrow on the clips it pushes later and the playhead as a line. "Over the video"
 * draws the item in a thin row above the clips, from the playhead, and nothing moves. The large
 * strip draws the REAL sequence condensed (`condensePlacement`: clips near the playhead and the
 * new item one by one, the rest folded into "N clips"); the small one draws a fixed schematic
 * proportionally. A drawing only: the sentence next to it is the text.
 */
export function PlacementStrip({
  preview,
  size,
  newLabel,
}: PlacementStripProps): React.JSX.Element {
  if (size === "large") return <LargeStrip preview={preview} newLabel={newLabel} />;
  const total = Math.max(preview.total, Number.EPSILON);
  const percent = (seconds: number): string => `${(seconds / total) * 100}%`;
  return (
    <div className={`${styles.strip} ${styles.small}`} aria-hidden>
      {preview.blocks.map((block) => (
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
          />
        </span>
      ))}
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
          />
        </span>
      )}
    </div>
  );
}

function LargeStrip({
  preview,
  newLabel,
}: Pick<PlacementStripProps, "preview" | "newLabel">): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const condensed = condensePlacement(preview);
  const percent = (share: number): string => `${share * 100}%`;
  const playhead = condensed.x(preview.playhead);
  return (
    <div className={`${styles.strip} ${styles.large}`} aria-hidden>
      <span className={`${styles.track} ${styles.trackTop}`} />
      <span className={`${styles.track} ${styles.trackMain}`} />
      {condensed.slots.map((slot) => {
        const share = slot.x1 - slot.x0;
        const arrow = slot.moved && share >= MIN_ARROW_SHARE && (
          <ArrowRight className={styles.moved} size={12} strokeWidth={2.4} />
        );
        return (
          <span
            key={slot.key}
            className={`${styles.slot} ${styles.main}`}
            style={{ left: percent(slot.x0), width: percent(share) }}
          >
            {slot.kind === "group" ? (
              <span
                className={`${styles.block} ${styles.group}`}
                data-testid="placement-group"
                data-count={slot.count}
                data-moved={slot.moved ? "true" : undefined}
              >
                <span className={styles.groupLabel}>
                  {t("addFromLibraryGroupClips", { count: slot.count })}
                </span>
                {arrow}
              </span>
            ) : (
              <span
                className={`${styles.block} ${slot.kind === "new" ? styles.fresh : styles.clip} ${
                  slot.current ? styles.current : ""
                }`}
                data-testid="placement-block"
                data-new={slot.kind === "new" ? "true" : undefined}
                data-moved={slot.moved ? "true" : undefined}
                data-current={slot.current ? "true" : undefined}
              >
                {slot.kind === "new" && (
                  <>
                    <Plus size={11} strokeWidth={2.6} />
                    <span className={styles.newLabel}>{newLabel}</span>
                  </>
                )}
                {arrow}
              </span>
            )}
          </span>
        );
      })}
      {condensed.floating && (
        <span
          className={`${styles.slot} ${styles.top}`}
          style={{
            left: percent(condensed.floating.x0),
            width: percent(condensed.floating.x1 - condensed.floating.x0),
          }}
        >
          <span
            className={`${styles.block} ${styles.fresh}`}
            data-testid="placement-block"
            data-new="true"
          >
            <span className={styles.floatLabel}>{newLabel}</span>
          </span>
        </span>
      )}
      <span className={styles.playhead} style={{ left: percent(playhead) }}>
        <span
          className={`${styles.youAreHere} ${
            playhead > CHIP_FLIP_SHARE ? styles.chipLeft : styles.chipRight
          }`}
          data-testid="placement-you-are-here"
        >
          {t("addFromLibraryYouAreHere")}
        </span>
        <span className={styles.flag} />
      </span>
    </div>
  );
}

export interface PlacementCardProps {
  preview: PlacementPreview;
  destination: LibraryDestination;
  /**
   * The destination this one lands exactly where (`sameAsDestination`): adds a second sentence
   * saying so, because the two menu options would otherwise look identical. Null for none.
   */
  sameAs?: "start" | "end" | null;
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
  sameAs = null,
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
  const sameAsNote =
    sameAs === "end"
      ? t("addFromLibrarySameAsEnd", { option: t("addFromLibraryDestEnd") })
      : sameAs === "start"
        ? t("addFromLibrarySameAsStart", { option: t("addFromLibraryDestStart") })
        : null;
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
        {sameAsNote && (
          <>
            {" "}
            <span data-testid="placement-same-as">{sameAsNote}</span>
          </>
        )}
      </p>
    </div>
  );
}
