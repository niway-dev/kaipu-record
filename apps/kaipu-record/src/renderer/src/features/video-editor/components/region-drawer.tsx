/**
 * Drawing a privacy region (UI spec § 4.4). Active while the Blur or Cover tool is on.
 * Lives in the stage chrome over the UNZOOMED frame (the camera is off while a privacy
 * tool is active), so stage-normalized pointer coordinates ARE original-frame coordinates.
 * Shows marching ants, a size badge in SOURCE pixels, a range badge, a live effect; the
 * page mirrors the draft as a ghost block on the Privacy lane via onDraft.
 */
import { useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import {
  blurSigmaPx,
  type NormRect,
  rectFromDrag,
  rectToPx,
  REDACTION,
} from "../privacy/redaction";
import { rectStyle } from "./redaction-layer";
import styles from "./region-drawer.module.css";

export function RegionDrawer({
  kind,
  videoRef,
  range,
  onDraft,
  onCreate,
}: {
  kind: "blur" | "cover";
  /** The preview video — its native size feeds the size badge (source pixels). */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Formatted source window the region will get ("0:12.0" → "0:17.0"); null over a slide. */
  range: { from: string; to: string } | null;
  onDraft(rect: NormRect | null): void;
  onCreate(rect: NormRect): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const surface = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<NormRect | null>(null);
  const [surfaceHeight, setSurfaceHeight] = useState(0);

  const norm = (event: React.PointerEvent): { x: number; y: number } => {
    const r = surface.current!.getBoundingClientRect();
    return { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height };
  };

  const video = videoRef.current;
  const px = rect && video ? rectToPx(rect, video.videoWidth, video.videoHeight) : null;

  // A pointer gesture can end without a pointerup (system gesture, capture stolen).
  // Abort the draft cleanly rather than stranding a half-drawn ghost — same contract as
  // VideoAnnotationLayer's onPointerAbort and ZoomLane's handle abort.
  const abort = (): void => {
    if (!start.current) return;
    start.current = null;
    setRect(null);
    onDraft(null);
  };

  return (
    <div
      ref={surface}
      className={styles.surface}
      data-testid="region-drawer"
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!surface.current) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        start.current = norm(event);
        setSurfaceHeight(surface.current.clientHeight);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        const p = norm(event);
        const next = rectFromDrag(start.current.x, start.current.y, p.x, p.y);
        setRect(next);
        onDraft(next);
      }}
      onPointerUp={() => {
        const drawn = rect;
        start.current = null;
        setRect(null);
        onDraft(null);
        if (drawn && drawn.w >= REDACTION.minSize && drawn.h >= REDACTION.minSize) onCreate(drawn);
      }}
      onPointerCancel={abort}
      onLostPointerCapture={abort}
    >
      {rect && px && (
        <div
          className={kind === "cover" ? `${styles.draft} ${styles.draftCover}` : styles.draft}
          style={{
            ...rectStyle(rect),
            ...(kind === "blur"
              ? {
                  backdropFilter: `blur(${blurSigmaPx(REDACTION.defaultIntensity, surfaceHeight)}px)`,
                }
              : {}),
          }}
        >
          <svg className={styles.ants} width="100%" height="100%" aria-hidden>
            <rect x="0" y="0" width="100%" height="100%" />
          </svg>
          <span className={styles.sizeBadge}>
            {t("drawSizeBadge", {
              w: px.w,
              h: px.h,
              kind: kind === "blur" ? t("blurBadge") : t("coverBadge"),
            })}
          </span>
          {range && (
            <span className={styles.rangeBadge}>
              {t("drawRangeBadge", { from: range.from, to: range.to })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
