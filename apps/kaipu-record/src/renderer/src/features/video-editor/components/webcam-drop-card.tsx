/**
 * The card that asks where a dropped camera bubble belongs (camera parts, drag-first): "Only
 * for this part", "For the whole video", or Close to put it back. It sits in the preview's
 * chrome, attached to the bubble's new place and kept inside the preview, and while it is open
 * the preview draws the route from where the camera is now to the dropped place — with
 * `webcamRoute`, the function the slide itself follows, so what is drawn is what would play.
 * Paused editor only: the hook closes the card when playback starts.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import type { WebcamPendingDrop } from "../webcam/use-webcam-drop";
import type { FrameSize } from "../webcam/webcam-layout";
import { webcamRoute } from "../webcam/webcam-route";
import styles from "./webcam-drop-card.module.css";

const CARD_WIDTH = 360;
/** Before the card is measured: close to its real height. */
const CARD_HEIGHT_GUESS = 108;
/** Space kept between the card, the bubble and the preview's edge, in px. */
const GAP = 12;
/** A route shorter than this (px) draws nothing: the bubble would not move. */
const MIN_ROUTE_PX = 10;

/** "0:24": minutes and whole seconds. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds + 1e-6));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

interface Size {
  w: number;
  h: number;
}

export function WebcamDropCard({
  card,
  frame,
  onPart,
  onWhole,
  onClose,
}: {
  card: WebcamPendingDrop;
  /** The output frame the bubble's pixels are in. */
  frame: FrameSize;
  onPart(): void;
  onWhole(): void;
  onClose(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [cardHeight, setCardHeight] = useState(CARD_HEIGHT_GUESS);

  // The preview's size in CSS px, before paint and on resize: the card is placed and the
  // route drawn in it, while the bubble's own numbers are in frame pixels.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = (): void => {
      const rect = root.getBoundingClientRect();
      setSize((previous) =>
        previous.w === rect.width && previous.h === rect.height
          ? previous
          : { w: rect.width, h: rect.height },
      );
      const height = cardRef.current?.offsetHeight ?? 0;
      if (height > 0) setCardHeight(height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const scale = frame.width > 0 ? size.w / frame.width : 0;
  const end = { x: card.position.x * frame.width, y: card.position.y * frame.height };
  const reach = {
    minX: card.box.width / 2,
    maxX: frame.width - card.box.width / 2,
    minY: card.box.height / 2,
    maxY: frame.height - card.box.height / 2,
  };
  const route = webcamRoute(card.now, end, frame, reach);
  const start = { x: route.start.x * scale, y: route.start.y * scale };
  const control = { x: route.control.x * scale, y: route.control.y * scale };
  const target = { x: route.end.x * scale, y: route.end.y * scale };
  const radius = (card.box.height / 2) * scale;
  const drawRoute = Math.hypot(target.x - start.x, target.y - start.y) >= MIN_ROUTE_PX;
  const middle = {
    x: 0.25 * start.x + 0.5 * control.x + 0.25 * target.x,
    y: 0.25 * start.y + 0.5 * control.y + 0.25 * target.y,
  };
  const angle = Math.atan2(target.y - control.y, target.x - control.x);
  // The arrowhead stops short of the new bubble, which would cover it.
  const tip = {
    x: target.x - Math.cos(angle) * (radius + 8),
    y: target.y - Math.sin(angle) * (radius + 8),
  };

  // Below the bubble when it sits in the upper half, above otherwise; shifted so the whole
  // card stays inside the preview.
  const width = size.w > 0 ? Math.min(CARD_WIDTH, size.w - 2 * GAP) : CARD_WIDTH;
  const left = Math.max(GAP, Math.min(size.w - width - GAP, target.x - width / 2));
  const below = target.y < size.h / 2;
  const wanted = below ? target.y + radius + GAP : target.y - radius - GAP - cardHeight;
  const top = Math.max(GAP, Math.min(size.h - cardHeight - GAP, wanted));

  const room = card.room;
  return (
    <div
      ref={rootRef}
      {...uiArea("editorVideo.webcamDrop")}
      className={styles.root}
      data-testid="webcam-drop"
    >
      {drawRoute && size.w > 0 && (
        <>
          <svg className={styles.route} width={size.w} height={size.h} aria-hidden="true">
            <path
              className={styles.routeShadow}
              d={`M${start.x} ${start.y} Q ${control.x} ${control.y} ${target.x} ${target.y}`}
            />
            <path
              className={styles.routeLine}
              d={`M${start.x} ${start.y} Q ${control.x} ${control.y} ${target.x} ${target.y}`}
            />
            <path
              className={styles.routeLine}
              d="M-9 -6 L0 0 L-9 6"
              transform={`translate(${tip.x} ${tip.y}) rotate(${(angle * 180) / Math.PI})`}
              data-testid="webcam-drop-arrow"
            />
          </svg>
          <span
            className={styles.tag}
            style={{
              left: start.x,
              top: start.y > size.h / 2 ? start.y - radius - 26 : start.y + radius + 6,
            }}
            data-testid="webcam-drop-now"
          >
            {t("webcamDropNow")}
          </span>
          <span className={styles.chip} style={{ left: middle.x, top: middle.y - 13 }}>
            <ArrowRight size={12} strokeWidth={2.2} />
            {t("webcamDropNew")}
          </span>
        </>
      )}
      <div
        ref={cardRef}
        className={styles.card}
        style={{ left, top, width }}
        role="group"
        aria-label={t("webcamDropAria")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <span className={styles.title}>{t("webcamDropTitle")}</span>
          <button
            type="button"
            className={styles.close}
            aria-label={t("webcamDropClose")}
            title={t("webcamDropClose")}
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>
        <div className={styles.choices}>
          <button
            type="button"
            className={`${styles.choice} ${styles.primary}`}
            disabled={!room}
            onClick={onPart}
          >
            <span className={styles.choiceTitle}>{t("webcamDropPart")}</span>
            <span className={styles.choiceDetail}>
              {room
                ? t("webcamDropPartDetail", {
                    seconds: Math.round(room.end - room.start),
                    time: clock(room.start),
                  })
                : t("webcamDropNoRoom")}
            </span>
          </button>
          <button type="button" className={styles.choice} onClick={onWhole}>
            <span className={styles.choiceTitle}>{t("webcamDropWhole")}</span>
            <span className={styles.choiceDetail}>{t("webcamDropWholeDetail")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
