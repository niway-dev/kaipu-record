import React, { useEffect, useRef, useState, type PointerEvent } from "react";
import { Camera, X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useCameraPreview } from "@renderer/features/recording/hooks/use-camera-preview";
import { useRecordingActivity } from "@renderer/features/recording/hooks/use-recording-activity";
import {
  CAMERA_BUBBLE_WINDOW_PAD,
  DEFAULT_CAMERA_BUBBLE,
  cameraBubbleBox,
  cameraBubblePresetFor,
  cameraCornerRadiusPx,
  framingTransform,
  clampCameraBubbleSize,
  type CameraBubbleSettings,
} from "@shared/camera-bubble";
import { bubblePreviewLines } from "@shared/webcam-track";
import styles from "./camera-bubble.module.css";

/**
 * The bubble's height: the window's, minus the pad main sizes it with. The window stays a
 * square for every shape (ADR 0041); a rectangle sits centred in it, narrower.
 */
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
 * keeps it parked (hidden) through a camera turned off mid-take (ADR 0037): the preview must
 * then release the camera itself, so the in-use light goes off. Off until main answers, so a
 * window parked before it was ready never opens the camera (its light would blink); on if
 * main cannot answer, as the window exists for a camera that is on. A broadcast that lands
 * before the first read wins, being newer.
 */
function useCameraOn(): boolean {
  const [on, setOn] = useState<boolean | null>(null);
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
      .catch(() => {
        if (!heard) setOn(true);
      });
    return unsubscribe;
  }, []);
  return on === true;
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
 * live webcam in a circle, a square or a 3:4 rectangle, with the corner radius from the
 * settings (ADR 0041). Pressing on the bubble and dragging moves it, during a
 * recording too: the pointer's offset goes to main, which moves the window and keeps it
 * inside the recorded area. There is no OS drag region, so the grip still gets its events.
 *
 * Outside a recording, hovering shows a pink outline, the size ("240 px · M"), a resize
 * grip and a close button that turns the camera off; dragging the grip resizes the bubble
 * from its bottom-left corner. From the moment a take is pending (its countdown) none of
 * that chrome renders, and at rest the bubble has no border, so the bubble on screen is
 * exactly the one in the video (the control bar, which the video leaves out, offers the same
 * "turn camera off" during a take).
 */
export function CameraBubble(): React.JSX.Element {
  const t = useTranslations("cameraSettings");
  const bubble = useBubbleSettings();
  const activity = useRecordingActivity();
  // A new resolution reopens the camera, and the bubble blinks while it does: during a take
  // that blink would be in the video. So the lines stay as they were when the take started
  // (the zoom itself still applies at once) and catch up when it ends.
  // Never fewer than the recorder's webcam track needs: both windows share the camera (ADR 0037).
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
  // A pending take (countdown, streams acquiring) hides the chrome too: the `active` broadcast
  // reaches this window only after the capture has started, so waiting for it would put the
  // chrome in the first frames of the video.
  const inTake = recording || activity.pending === true;
  // A take that starts mid-drag ends the drag (no chrome may reach the video) and saves the
  // size it reached, so the window never keeps an unsaved preview size for the take.
  useEffect(() => {
    if (!inTake) return;
    const session = drag.current;
    drag.current = null;
    setDragging(false);
    if (session) void settleGrip(session, latestBubble);
  }, [inTake]);
  const showChrome = !inTake && (hovered || dragging);

  const onGripDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (inTake) return;
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
  const box = cameraBubbleBox(bubble.shape, size);
  const radius = `${Math.round(cameraCornerRadiusPx(bubble.shape, bubble.cornerRadius, box.width, box.height))}px`;
  // The rectangle is narrower than the square window: centre it, and its chrome with it.
  const insetX = CAMERA_BUBBLE_WINDOW_PAD + Math.round((size - box.width) / 2);

  return (
    <div
      className={styles.root}
      style={{ "--inset-x": `${insetX}px` } as React.CSSProperties}
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
          style={bubble.shape !== "circle" ? { borderTopRightRadius: radius } : undefined}
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
