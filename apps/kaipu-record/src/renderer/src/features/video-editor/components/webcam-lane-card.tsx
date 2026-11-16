/**
 * The card the Camera lane shows over the stretch under the pointer (camera parts, spec
 * decision 16): the place and what the stretch is, its range and length, and how it arrives.
 * On a long recording a short part is a few pixels wide, so nothing of this can be read in the
 * lane itself; the lane is for finding a stretch and this card is for reading it.
 *
 * It is a tooltip, not a control: it takes no pointer events, it is drawn in the page's top
 * layer (the timeline's scroller clips whatever sticks out of it) and it is placed from
 * client pixels the lane measured when the pointer moved. Pure from its props.
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EyeOff } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { WebcamStretchCard } from "../webcam/webcam-stretches";
import { formatPrecise } from "./inspector/format";
import { EASING_LABEL, NAME_LABEL } from "./webcam-name-label";
import styles from "./webcam-lane-card.module.css";

/** Where the card goes, in client pixels, measured by the lane when the pointer moved. */
export interface CardAnchor {
  /** The pointer's x (or the middle of the focused stretch). */
  clientX: number;
  /** The lane's top and bottom: the card sits above it, or below when there is no room above. */
  laneTop: number;
  laneBottom: number;
  /** The timeline's visible area: the card never leaves it. */
  left: number;
  right: number;
}

/** The space (px) between the card and the lane, and between the card and the area's edge. */
const GAP = 6;
const EDGE = 4;

/**
 * The card's left edge: centred on the pointer, then moved to stay inside `[left, right]`. A
 * card wider than the area starts at the area's left edge.
 */
export function clampCardLeft(
  clientX: number,
  width: number,
  bounds: { left: number; right: number },
): number {
  const max = bounds.right - width - EDGE;
  const min = bounds.left + EDGE;
  return Math.max(min, Math.min(clientX - width / 2, max));
}

export function WebcamLaneCard({
  card,
  glyph,
  anchor,
}: {
  card: WebcamStretchCard;
  /** The small frame with the dot, drawn by the lane; null for a hidden range. */
  glyph: ReactNode;
  anchor: CardAnchor;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const ref = useRef<HTMLDivElement | null>(null);

  // Placed before paint, from the card's own size, so it never shows in the wrong place.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.left = `${clampCardLeft(anchor.clientX, el.offsetWidth, anchor)}px`;
    const above = anchor.laneTop - el.offsetHeight - GAP;
    el.style.top = `${above >= EDGE ? above : anchor.laneBottom + GAP}px`;
  }, [anchor]);

  const title =
    card.kind === "hidden" ? t("webcamHiddenTitle") : card.name ? t(NAME_LABEL[card.name]) : "";
  const length = (card.end - card.start).toFixed(1);
  const range = `${formatPrecise(card.start)} – ${formatPrecise(card.end)} · ${t("webcamPartLength", { seconds: length })}`;
  let how: string | null = null;
  if (card.kind === "original") {
    how = t("webcamMarkOriginalTag");
  } else if (card.arrives?.kind === "slide") {
    how = `${t("webcamMarkSlide", { seconds: String(Number(card.arrives.seconds.toFixed(2))) })} · ${t(EASING_LABEL[card.arrives.easing])}`;
  } else if (card.arrives?.kind === "cut") {
    how = t("webcamMarkCut");
  }

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className={styles.card}
      data-webcam-card={card.kind}
      style={{ left: anchor.clientX, top: anchor.laneTop }}
    >
      <div className={styles.head}>
        {card.kind === "hidden" ? (
          <EyeOff size={14} className={styles.icon} aria-hidden="true" />
        ) : (
          glyph
        )}
        <span className={styles.title}>{title}</span>
      </div>
      <div className={styles.range}>{range}</div>
      {how && <div className={styles.how}>{how}</div>}
    </div>,
    document.body,
  );
}
