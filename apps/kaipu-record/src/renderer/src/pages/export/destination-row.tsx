import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { CopyPlan, DestinationId } from "@renderer/features/prepare/destinations";
import { groupOf } from "@renderer/features/prepare/destinations";
import { DestinationLogo } from "@renderer/features/prepare/components/destination-logo";
import { EXPORT_NAME, EXPORT_ORDER } from "./export-copy";
import styles from "./destination-row.module.css";

/** What the cards say about each copy; there is none before a video is picked. */
export interface DestinationSizes {
  planFor(destination: DestinationId): CopyPlan;
  /** "~570 MB", "up to ~570 MB", or "Full size". */
  sizeText(plan: CopyPlan): string;
  /** A copy of this destination already exists from the whole recording. */
  isReady(destination: DestinationId): boolean;
}

interface DestinationRowProps {
  /** Null when nothing is picked yet: the stage asks "Where is it going?". */
  selected: DestinationId | null;
  onSelect(destination: DestinationId): void;
  /** Omitted with no video: the cards show no size. */
  sizes?: DestinationSizes;
}

/**
 * The Export screen's bottom row: the seven destinations as equal cards, the selected one in
 * pink. Pinned under the stage, so the video and the choice stay in view together. When the
 * cards cannot all fit, the row scrolls sideways on its own; the page never scrolls.
 */
export function DestinationRow({
  selected,
  onSelect,
  sizes,
}: DestinationRowProps): React.JSX.Element {
  const t = useTranslations("export");
  const cards = useRef(new Map<DestinationId, HTMLButtonElement>());

  // Arrows can move the selection off screen: bring the card into view, sideways only.
  useEffect(() => {
    if (!selected) return;
    cards.current.get(selected)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selected]);

  return (
    <section className={styles.panel} aria-labelledby="export-row-label">
      <div className={styles.head}>
        <span id="export-row-label" className={styles.label}>
          {t("rowLabel")}
        </span>
        <span className={styles.legend} data-tone="bigger">
          ● {t("legendBigger")}
        </span>
        <span className={styles.legend} data-tone="light">
          ● {t("legendLight")}
        </span>
      </div>
      <div role="radiogroup" aria-labelledby="export-row-label" className={styles.row}>
        {EXPORT_ORDER.map((d) => {
          const active = selected === d;
          return (
            <button
              key={d}
              ref={(node) => {
                if (node) cards.current.set(d, node);
                else cards.current.delete(d);
              }}
              type="button"
              role="radio"
              aria-checked={active}
              // One tab stop for the group; arrows move inside it.
              tabIndex={active || (selected === null && d === EXPORT_ORDER[0]) ? 0 : -1}
              className={styles.card}
              data-active={active}
              onClick={() => onSelect(d)}
            >
              <DestinationLogo destination={d} size={30} />
              <span className={styles.name}>{t(EXPORT_NAME[d])}</span>
              {sizes && <CardSize sizes={sizes} destination={d} />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** "Ready" when the copy already exists, else its estimated size, coloured by the legend. */
function CardSize({
  sizes,
  destination,
}: {
  sizes: DestinationSizes;
  destination: DestinationId;
}): React.JSX.Element {
  const t = useTranslations("export");
  if (sizes.isReady(destination)) {
    return (
      <span className={styles.ready}>
        <Check size={11} strokeWidth={2.4} aria-hidden />
        {t("readyBadge")}
      </span>
    );
  }
  return (
    <span className={styles.size} data-group={groupOf(destination)}>
      {sizes.sizeText(sizes.planFor(destination))}
    </span>
  );
}
