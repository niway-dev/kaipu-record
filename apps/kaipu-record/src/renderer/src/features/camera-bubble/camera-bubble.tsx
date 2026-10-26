import React, { useEffect, useRef, useState, type PointerEvent } from "react";
import { Camera } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useCameraPreview } from "@renderer/features/recording/hooks/use-camera-preview";
import { useRecordingActivity } from "@renderer/features/recording/hooks/use-recording-activity";
import {
  CAMERA_BUBBLE_WINDOW_PAD,
  DEFAULT_CAMERA_BUBBLE,
  cameraBubblePresetFor,
  clampCameraBubbleSize,
  type CameraBubbleSettings,
} from "@shared/camera-bubble";
import styles from "./camera-bubble.module.css";

/** The rounded square's corner, as a share of its side. */
const ROUNDED_RADIUS = 0.18;

/** The bubble's side: the window's, minus the pad main sizes it with. */
function sizeFromWindow(): number {
  return Math.max(
    0,
    Math.min(window.innerWidth, window.innerHeight) - 2 * CAMERA_BUBBLE_WINDOW_PAD,
  );
}

/** The persisted bubble settings, query on mount + subscribe. */
function useBubbleSettings(): CameraBubbleSettings {
  const [bubble, setBubble] = useState<CameraBubbleSettings>(DEFAULT_CAMERA_BUBBLE);
  useEffect(() => {
    void window.electronAPI.getSettings().then((settings) => setBubble(settings.cameraBubble));
    return window.electronAPI.onSettingsChanged((settings) => setBubble(settings.cameraBubble));
  }, []);
  return bubble;
}

/**
 * Projects a pointer move from the grip's start onto the bubble's diagonal: the window
 * keeps its bottom-left corner, so growing by `d` moves the top-right grip by (+d, −d).
 */
export function gripDragSize(startSize: number, dx: number, dy: number): number {
  return clampCameraBubbleSize(startSize + (dx - dy) / 2);
}

/**
 * Root mounted in the floating camera-bubble window (`?window=camera-bubble`). Shows the
 * live webcam in a circle or a rounded square; the screen recording captures it because
 * the window sits on screen. It does not move (it lives at the bottom-left corner of the
 * recorded area) and has no drag region.
 *
 * Outside a recording, hovering shows a pink outline, the size ("240 px · M") and a resize
 * grip; dragging the grip resizes the bubble from its anchored corner. Once a recording
 * starts none of that chrome renders, so the bubble on screen is exactly the one in the
 * video.
 */
export function CameraBubble(): React.JSX.Element {
  const t = useTranslations("cameraSettings");
  const bubble = useBubbleSettings();
  const activity = useRecordingActivity();
  const { videoRef, hasStream } = useCameraPreview(true, bubble.deviceId);
  const [size, setSize] = useState(sizeFromWindow);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; size: number; applied: number } | null>(null);
  const inFlight = useRef(false);
  const queued = useRef<number | null>(null);

  useEffect(() => {
    const onResize = (): void => setSize(sizeFromWindow());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const recording = activity.active;
  // A recording that starts mid-drag ends the drag: no chrome may reach the video.
  useEffect(() => {
    if (recording) {
      drag.current = null;
      setDragging(false);
    }
  }, [recording]);
  const showChrome = !recording && (hovered || dragging);

  /** One preview request at a time; the latest wanted size wins. */
  const requestPreview = (wanted: number): void => {
    if (inFlight.current) {
      queued.current = wanted;
      return;
    }
    inFlight.current = true;
    void window.electronAPI
      .previewCameraBubbleSize(wanted)
      .then((applied) => {
        if (drag.current) drag.current.applied = applied;
      })
      .finally(() => {
        inFlight.current = false;
        const next = queued.current;
        queued.current = null;
        if (next !== null && drag.current) requestPreview(next);
      });
  };

  const onGripDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (recording) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.screenX, y: event.screenY, size, applied: size };
    setDragging(true);
  };

  const onGripMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    if (!start) return;
    requestPreview(gripDragSize(start.size, event.screenX - start.x, event.screenY - start.y));
  };

  const onGripUp = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    drag.current = null;
    setDragging(false);
    if (!start) return;
    // Persist what is on screen (the area may have clamped what was asked for).
    void window.electronAPI.updateSettings({
      cameraBubble: { ...bubble, size: start.applied },
    });
  };

  const preset = cameraBubblePresetFor(size);
  const radius = bubble.shape === "circle" ? "50%" : `${Math.round(size * ROUNDED_RADIUS)}px`;

  return (
    <div
      className={styles.root}
      data-shape={bubble.shape}
      data-chrome={showChrome || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {showChrome && (
        <span className={styles.sizeLabel} data-testid="bubble-size-label">
          {preset ? t("bubbleLabel", { size, preset }) : t("bubbleLabelCustom", { size })}
        </span>
      )}
      <div className={styles.bubble} style={{ borderRadius: radius }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={styles.video}
          style={{ display: hasStream ? "block" : "none" }}
        />
        {!hasStream && <Camera size={30} className={styles.placeholder} />}
      </div>
      {showChrome && (
        <div
          className={bubble.shape === "circle" ? styles.gripCircle : styles.gripRounded}
          style={bubble.shape === "rounded" ? { borderTopRightRadius: radius } : undefined}
          data-testid="bubble-resize-grip"
          title={t("resizeGrip")}
          aria-hidden
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
        />
      )}
    </div>
  );
}
