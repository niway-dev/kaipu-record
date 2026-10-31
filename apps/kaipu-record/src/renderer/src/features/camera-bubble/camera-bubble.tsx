import React, { useEffect, useRef, useState, type PointerEvent } from "react";
import { Camera, X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useCameraPreview } from "@renderer/features/recording/hooks/use-camera-preview";
import { useRecordingActivity } from "@renderer/features/recording/hooks/use-recording-activity";
import {
  CAMERA_BUBBLE_WINDOW_PAD,
  DEFAULT_CAMERA_BUBBLE,
  cameraBubblePresetFor,
  framingTransform,
  clampCameraBubbleSize,
  type CameraBubbleSettings,
} from "@shared/camera-bubble";
import { bubblePreviewLines } from "@shared/webcam-track";
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
 * Whether the Camera toggle is on. The window only exists while it is, except while a take
 * keeps it parked (hidden) through a camera turned off mid-take (ADR 0032): the preview must
 * then release the camera itself, so the in-use light goes off. On until main says otherwise;
 * a broadcast that lands before the first read wins, being newer.
 */
function useCameraOn(): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    let heard = false;
    const unsubscribe = window.electronAPI.onRecordingSettingsChanged((settings) => {
      heard = true;
      setOn(settings.isCameraEnabled);
    });
    void window.electronAPI
      .getRecordingSettings()
      .then((settings) => {
        if (!heard) setOn(settings.isCameraEnabled);
      })
      .catch(() => undefined);
    return unsubscribe;
  }, []);
  return on;
}

/**
 * Projects a pointer move from the grip's start onto the bubble's diagonal: the window
 * keeps its bottom-left corner, so growing by `d` moves the top-right grip by (+d, −d).
 */
export function gripDragSize(startSize: number, dx: number, dy: number): number {
  return clampCameraBubbleSize(startSize + (dx - dy) / 2);
}

/** One grip drag: where it started, what main last applied, and its preview queue. */
interface GripSession {
  x: number;
  y: number;
  size: number;
  /** The size main last put on screen (it clamps to the area). */
  applied: number;
  /** The preview request in flight, if any. */
  inFlight: Promise<void> | null;
  /** The latest size wanted while a request was in flight; sent when it returns. */
  queued: number | null;
}

/** One preview request at a time per session; the latest wanted size wins. */
function requestPreview(session: GripSession, wanted: number): void {
  if (session.inFlight) {
    session.queued = wanted;
    return;
  }
  session.inFlight = window.electronAPI
    .previewCameraBubbleSize(wanted)
    .then((applied) => {
      session.applied = applied;
    })
    .catch(() => {})
    .finally(() => {
      session.inFlight = null;
      const next = session.queued;
      session.queued = null;
      if (next !== null) requestPreview(session, next);
    });
}

/**
 * Wait for the session's previews (in flight, then queued), then save what is on screen
 * (the area may have clamped what was asked for). The bubble is read after the wait, so a
 * shape or device change made meanwhile is kept.
 */
async function settleGrip(
  session: GripSession,
  bubble: { readonly current: CameraBubbleSettings },
): Promise<void> {
  while (session.inFlight) await session.inFlight;
  await window.electronAPI.updateSettings({
    cameraBubble: { ...bubble.current, size: session.applied },
  });
}

/**
 * Root mounted in the floating camera-bubble window (`?window=camera-bubble`). Shows the
 * live webcam in a circle or a rounded square; the screen recording captures it because
 * the window sits on screen. Pressing on the bubble and dragging moves it, during a
 * recording too: the pointer's offset goes to main, which moves the window and keeps it
 * inside the recorded area. There is no OS drag region, so the grip still gets its events.
 *
 * Outside a recording, hovering shows a pink outline, the size ("240 px · M"), a resize
 * grip and a close button that turns the camera off; dragging the grip resizes the bubble
 * from its bottom-left corner. Once a recording starts none of that chrome renders, so the
 * bubble on screen is exactly the one in the video (the control bar, which the video
 * leaves out, offers the same "turn camera off" during a take).
 */
export function CameraBubble(): React.JSX.Element {
  const t = useTranslations("cameraSettings");
  const bubble = useBubbleSettings();
  const activity = useRecordingActivity();
  // A new resolution reopens the camera, and the bubble blinks while it does: during a take
  // that blink would be in the video. So the lines stay as they were when the take started
  // (the zoom itself still applies at once) and catch up when it ends.
  // Never fewer than the recorder's webcam track needs: both windows share the camera (ADR 0032).
  const wantedLines = bubblePreviewLines(bubble);
  const takeLines = useRef(wantedLines);
  if (!activity.active) takeLines.current = wantedLines;
  const cameraOn = useCameraOn();
  const { videoRef, hasStream } = useCameraPreview(cameraOn, bubble.deviceId, takeLines.current);
  const [size, setSize] = useState(sizeFromWindow);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The pointer drag in progress. Its session outlives it: a preview reply that lands after
  // the release still updates the session, and the release waits for it before saving.
  const drag = useRef<GripSession | null>(null);
  // The move in progress: the pointer's screen position when it went down on the bubble.
  const move = useRef<{ x: number; y: number } | null>(null);
  const latestBubble = useRef(bubble);
  latestBubble.current = bubble;

  useEffect(() => {
    const onResize = (): void => setSize(sizeFromWindow());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const recording = activity.active;
  // A recording that starts mid-drag ends the drag (no chrome may reach the video) and saves
  // the size it reached, so the window never keeps an unsaved preview size for the take.
  useEffect(() => {
    if (!recording) return;
    const session = drag.current;
    drag.current = null;
    setDragging(false);
    if (session) void settleGrip(session, latestBubble);
  }, [recording]);
  const showChrome = !recording && (hovered || dragging);

  const onGripDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (recording) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      x: event.screenX,
      y: event.screenY,
      size,
      applied: size,
      inFlight: null,
      queued: null,
    };
    setDragging(true);
  };

  const onGripMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    if (!start) return;
    requestPreview(
      start,
      gripDragSize(start.size, event.screenX - start.x, event.screenY - start.y),
    );
  };

  const onGripUp = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    drag.current = null;
    setDragging(false);
    if (!start) return;
    void settleGrip(start, latestBubble);
  };

  const onBubbleDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    move.current = { x: event.screenX, y: event.screenY };
    window.electronAPI.beginCameraBubbleMove();
  };

  const onBubbleMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = move.current;
    if (!start) return;
    window.electronAPI.moveCameraBubble(event.screenX - start.x, event.screenY - start.y);
  };

  const onBubbleUp = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    move.current = null;
  };

  const preset = cameraBubblePresetFor(size);
  const radius = bubble.shape === "circle" ? "50%" : `${Math.round(size * ROUNDED_RADIUS)}px`;

  return (
    <div
      className={styles.root}
      data-shape={bubble.shape}
      data-mirrored={bubble.mirrored || undefined}
      data-chrome={showChrome || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {showChrome && (
        <span className={styles.sizeLabel} data-testid="bubble-size-label">
          {preset ? t("bubbleLabel", { size, preset }) : t("bubbleLabelCustom", { size })}
        </span>
      )}
      <div
        className={styles.bubble}
        style={{ borderRadius: radius }}
        data-testid="camera-bubble"
        onPointerDown={onBubbleDown}
        onPointerMove={onBubbleMove}
        onPointerUp={onBubbleUp}
        onPointerCancel={onBubbleUp}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={styles.video}
          style={{
            display: hasStream ? "block" : "none",
            // Framing on: zoom + pan + the mirror in one transform (it overrides the CSS flip).
            ...(bubble.framing.enabled
              ? { transform: framingTransform(bubble.framing, bubble.mirrored) }
              : null),
          }}
        />
        {!hasStream && <Camera size={30} className={styles.placeholder} />}
      </div>
      {showChrome && (
        <button
          type="button"
          className={bubble.shape === "circle" ? styles.closeCircle : styles.closeRounded}
          data-testid="bubble-camera-off"
          aria-label={t("turnCameraOff")}
          title={t("turnCameraOff")}
          // The camera toggle is global: main destroys this window and releases the device.
          onClick={() => window.electronAPI.updateRecordingSettings({ isCameraEnabled: false })}
        >
          <X size={12} strokeWidth={3} aria-hidden />
        </button>
      )}
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
