/**
 * The webcam layer in the preview (ADR 0038, spec § 6): a second <video> playing the
 * recording's webcam file, drawn in PreviewStage's `webcam` slot — untransformed, so with a
 * zoom active the face stays in its corner — and kept in step with the main video.
 *
 * Per frame, from the main video's frame clock and without React re-renders (like the
 * camera box): `webcamStateAt` picks the layout in force and the slide in progress (null
 * inside a hidden segment), `webcamStateRect` places it in the output frame with the camera
 * path's scale for "shrink during zoom" (the export reads the same pair, so the two agree at
 * one source time; no CSS transition moves the box), and `webcam-sync` decides visibility (the file's own first and last frame)
 * and whether the element drifted past 80 ms and needs a seek. While the main video plays, a
 * seek aims ahead by the last seek's measured duration, so it lands where the screen will be.
 * Play/pause/rate mirror the main element, and the webcam also pauses while the main one
 * waits for data, so the face does not run ahead of a buffering screen.
 *
 * Dragging the bubble moves ONLY its element (1:1 with the pointer, stopped by the frame
 * edge); the scene is not touched until the pointer is released, when `onDrop` reports the
 * normalized centre once. A press that moves under 3 px is a click and selects the bubble.
 *
 * `WebcamPlaybackLayer` is the same drawing without the editing: the Library's original
 * player puts the face where it was recorded with it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { framingTransform } from "@shared/camera-bubble";
import type { PreviewMedia } from "../playback-media";
import { useVideoFrameClock } from "../use-video-frame-clock";
import { type CameraPath, cameraAt } from "../zoom/camera-path";
import {
  clampWebcamCenter,
  type FrameSize,
  webcamClipPath,
  webcamStateRect,
} from "../webcam/webcam-layout";
import { webcamEndSeconds, webcamStateAt, type WebcamScene } from "../webcam/webcam-model";
import {
  type WebcamRecordings,
  webcamFileAt,
  webcamHasFrameAt,
  webcamResyncTarget,
  webcamSeekLead,
  webcamTimeFor,
} from "../webcam/webcam-sync";
import styles from "./webcam-layer.module.css";
import { uiArea } from "@renderer/lib/ui-area";

type Point = { x: number; y: number };

/** A press that moves less than this many screen pixels is a click, not a drag. */
const CLICK_SLOP_PX = 3;

/** jsdom and a rejected play() (interrupted by a seek) must not surface as errors. */
function safePlay(video: HTMLVideoElement): void {
  try {
    void video.play()?.catch(() => {});
  } catch {
    // not implemented (jsdom)
  }
}

function safePause(video: HTMLVideoElement): void {
  try {
    video.pause();
  } catch {
    // not implemented (jsdom)
  }
}

/** What both layers draw from: the main video's clock and the webcam's layout over time. */
interface WebcamSyncInput {
  /** The MAIN video: its frame clock drives the layer and its play/pause/rate the webcam's.
   *  With joined recordings it is the preview's `MediaSwitch`, and every time here is an
   *  AXIS second (ADR 0058). */
  videoRef: React.RefObject<PreviewMedia | null>;
  /** The opened recording's webcam URL; null when it was recorded without one. */
  src: string | null;
  /** Webcam time 0 − screen time 0 (ADR 0037): webcam time = t − startOffsetMs / 1000. This is
   *  the OPENED recording's; a joined recording brings its own through `recordings`. */
  startOffsetMs: number;
  /**
   * The webcam file of every recording, for a scene with joined ones. Each file plays against
   * its own recording's clock (the LOCAL second), so the layer swaps files when the playhead
   * crosses into another recording and hides during clips of one that has none. Absent with a
   * single recording, where `src` and `startOffsetMs` serve every second.
   */
  recordings?: WebcamRecordings;
  webcam: WebcamScene;
  /**
   * The recording's length in source seconds: the last block's return to the default layout
   * settles before it (`webcamStateAt`). Absent or unusable means no end is known.
   */
  endSeconds?: number;
  /** The camera path, for "shrink during zoom"; null where nothing zooms (the Library). */
  path: CameraPath | null;
  /** False when the preview shows the unzoomed frame (zoom-edit view, privacy editing). */
  cameraEnabled: boolean;
  /** The output frame the layout is relative to; in a player, the decoded source size. */
  frame: FrameSize;
  /** Hold-to-see-original and slides: nothing of the webcam shows. */
  hidden: boolean;
}

/**
 * Places the bubble and keeps the webcam element in step with the main one, per frame and
 * without React re-renders. Shared by the editor's layer and the Library's read-only one, so
 * the original player draws the face exactly where the editor's first preview does.
 */
function useWebcamSync({
  videoRef,
  src,
  startOffsetMs,
  recordings,
  webcam,
  endSeconds,
  path,
  cameraEnabled,
  frame,
  hidden,
}: WebcamSyncInput) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const clipRef = useRef<HTMLDivElement | null>(null);
  const camRef = useRef<HTMLVideoElement | null>(null);
  const lastTime = useRef(0);
  // Where the bubble is drawn right now: the editor's drag starts from it.
  const drawn = useRef<{ center: Point; box: { width: number; height: number } } | null>(null);
  // When the webcam's seek in flight started (performance.now()), and how long the last one
  // took, in seconds: the lead the next seek during playback is given.
  const seekStartedAt = useRef<number | null>(null);
  const lastSeekSeconds = useRef(0);
  // The main video is playing but out of data (`waiting`); cleared on `playing`.
  const mainWaiting = useRef(false);
  // Where the bubble is held instead of where the scene has it: under the pointer during a
  // drag, and at the dropped place while the drop card waits for its answer.
  const held = useRef<Point | null>(null);

  const apply = (t: number): void => {
    lastTime.current = t;
    const box = boxRef.current;
    const cam = camRef.current;
    if (!box || !cam) return;
    const main = videoRef.current;
    // A faster or slower main video would otherwise drift past the resync threshold on
    // every frame and turn the face into a series of seeks.
    if (main && cam.playbackRate !== main.playbackRate) cam.playbackRate = main.playbackRate;
    // Layout, hide segments and the camera path are axis seconds; the file and its clock are
    // the recording's own, so the webcam time comes from the LOCAL second.
    const file = webcamFileAt(recordings, { src, startOffsetMs }, t);
    if (file.src !== null && cam.getAttribute("src") !== file.src)
      cam.setAttribute("src", file.src);
    const state = hidden ? null : webcamStateAt({ webcam }, t, webcamEndSeconds(endSeconds));
    const webcamTime = webcamTimeFor(file.localTime, file.startOffsetMs);
    const scale = cameraEnabled && path ? cameraAt(path, t).scale : 1;
    let rect =
      state && file.src !== null && webcamHasFrameAt(webcamTime, cam.duration)
        ? webcamStateRect(state, frame, scale)
        : null;
    if (rect && held.current) {
      const center = clampWebcamCenter(held.current, rect, frame);
      rect = {
        ...rect,
        x: center.x * frame.width - rect.width / 2,
        y: center.y * frame.height - rect.height / 2,
      };
    }
    if (!state || !rect) {
      box.style.display = "none";
      drawn.current = null;
      if (!cam.paused) safePause(cam);
      return;
    }
    // Everything but the position comes from the layout in force and applies at once.
    const layout = state.layout;
    box.style.display = "";
    box.style.left = `${(rect.x / frame.width) * 100}%`;
    box.style.top = `${(rect.y / frame.height) * 100}%`;
    box.style.width = `${(rect.width / frame.width) * 100}%`;
    box.style.height = `${(rect.height / frame.height) * 100}%`;
    box.dataset.shadow = String(layout.shadow);
    if (clipRef.current)
      clipRef.current.style.clipPath = webcamClipPath(layout.shape, layout.cornerRadius);
    cam.style.transform = framingTransform(layout.framing, layout.mirrored);
    // Where the bubble is drawn right now, mid-slide included: a drag starts from it.
    drawn.current = {
      center: {
        x: (rect.x + rect.width / 2) / frame.width,
        y: (rect.y + rect.height / 2) / frame.height,
      },
      box: { width: rect.width, height: rect.height },
    };
    // While a seek is in flight, currentTime already reads the pending target and the main
    // clock keeps moving: re-seeking on every frame would cancel each seek with the next one
    // and freeze the bubble after a cut or a scrub. Wait for `seeked` (below), then catch up.
    if (!cam.seeking) {
      const seekTo = webcamResyncTarget(cam.currentTime, webcamTime, cam.duration);
      if (seekTo !== null) {
        // The lead is for a moving clock: a waiting main video is not paused but holds still.
        const moving = !!main && !main.paused && !mainWaiting.current;
        const lead = webcamSeekLead(moving, lastSeekSeconds.current, main?.playbackRate ?? 1);
        const end = Number.isFinite(cam.duration) && cam.duration > 0 ? cam.duration : Infinity;
        seekStartedAt.current = performance.now();
        cam.currentTime = Math.min(seekTo + lead, end);
      }
    }
    if (main && !main.paused && cam.paused && !mainWaiting.current) safePlay(cam);
    if (main?.paused && !cam.paused) safePause(cam);
  };

  const trigger = useMemo(
    () => ({
      webcam,
      endSeconds,
      path,
      cameraEnabled,
      frame,
      hidden,
      src,
      startOffsetMs,
      recordings,
    }),
    [webcam, endSeconds, path, cameraEnabled, frame, hidden, src, startOffsetMs, recordings],
  );
  useVideoFrameClock(videoRef, apply, trigger);

  // Play, pause and a rate change land between frames (a paused element presents no frame),
  // so mirror them as they happen. A play outside the file is undone by the next apply().
  const applyRef = useRef(apply);
  applyRef.current = apply;
  // Whether a slide is under way at `t`, for the tick below (read through a ref, like apply).
  const slidingRef = useRef((_t: number): boolean => false);
  slidingRef.current = (t) =>
    !hidden && !!webcamStateAt({ webcam }, t, webcamEndSeconds(endSeconds))?.from;
  useEffect(() => {
    const main = videoRef.current;
    if (!main) return;
    const sync = (): void => applyRef.current(main.currentTime);
    // Out of data: hold the face where it is until the screen moves again. `stalled` only
    // means a fetch is slow — the screen may still be playing from its buffer — so it holds
    // only when the main element has nothing ahead to play (below HAVE_FUTURE_DATA).
    const waiting = (): void => {
      mainWaiting.current = true;
      const cam = camRef.current;
      if (cam && !cam.paused) safePause(cam);
    };
    const stalled = (): void => {
      if (main.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) waiting();
    };
    const resume = (): void => {
      mainWaiting.current = false;
      sync();
    };
    // The main video presents a frame only when the picture changes, so over a still screen
    // a slide would move once per `timeupdate`. The tick runs while the main video plays, but
    // only a slide under way calls `apply`, from the media clock on every display frame.
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const t = main.currentTime;
      if (!main.paused && slidingRef.current(t)) applyRef.current(t);
    };
    const startTicking = (): void => {
      if (typeof requestAnimationFrame !== "function") return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const stopTicking = (): void => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
    };
    if (!main.paused) startTicking();
    main.addEventListener("play", startTicking);
    main.addEventListener("pause", stopTicking);
    main.addEventListener("ended", stopTicking);
    main.addEventListener("play", sync);
    main.addEventListener("pause", sync);
    main.addEventListener("ratechange", sync);
    main.addEventListener("waiting", waiting);
    main.addEventListener("stalled", stalled);
    main.addEventListener("playing", resume);
    return () => {
      stopTicking();
      main.removeEventListener("play", startTicking);
      main.removeEventListener("pause", stopTicking);
      main.removeEventListener("ended", stopTicking);
      main.removeEventListener("play", sync);
      main.removeEventListener("pause", sync);
      main.removeEventListener("ratechange", sync);
      main.removeEventListener("waiting", waiting);
      main.removeEventListener("stalled", stalled);
      main.removeEventListener("playing", resume);
    };
  }, [videoRef]);

  const resync = (): void => apply(videoRef.current?.currentTime ?? lastTime.current);
  const onSeeked = (): void => {
    if (seekStartedAt.current !== null) {
      lastSeekSeconds.current = (performance.now() - seekStartedAt.current) / 1000;
      seekStartedAt.current = null;
    }
    resync();
  };
  return { boxRef, clipRef, camRef, lastTime, drawn, held, resync, onSeeked };
}

/** The webcam file inside the bubble's shape: the part both layers render the same way. */
function WebcamMedia({
  sync,
  src,
}: {
  sync: ReturnType<typeof useWebcamSync>;
  src: string | null;
}): React.JSX.Element {
  return (
    <div ref={sync.clipRef} className={styles.clip}>
      <video
        ref={sync.camRef}
        className={styles.video}
        src={src ?? undefined}
        muted
        playsInline
        preload="auto"
        data-testid="webcam-video"
        onLoadedMetadata={sync.resync}
        onSeeked={sync.onSeeked}
      />
    </div>
  );
}

/**
 * The face over a player that only plays (the Library's original): the same placement,
 * gaps and sync as the editor's layer, with nothing to select or drag. Pointers pass
 * through to the player's controls.
 */
export function WebcamPlaybackLayer({
  ...input
}: Omit<WebcamSyncInput, "path" | "cameraEnabled" | "hidden" | "recordings">): React.JSX.Element {
  const { src } = input;
  const sync = useWebcamSync({ ...input, path: null, cameraEnabled: false, hidden: false });
  return (
    <div className={styles.slot} data-testid="webcam-slot" aria-hidden>
      <div
        ref={sync.boxRef}
        className={styles.bubble}
        style={{ display: "none" }}
        data-testid="webcam-layer"
        data-interactive="false"
      >
        <WebcamMedia sync={sync} src={src} />
      </div>
    </div>
  );
}

export function WebcamLayer({
  videoRef,
  src,
  startOffsetMs,
  recordings,
  webcam,
  endSeconds,
  path,
  cameraEnabled,
  frame,
  hidden,
  interactive,
  selected,
  dropAt,
  onSelect,
  onDrop,
  onHeldChange,
}: Omit<WebcamSyncInput, "path"> & {
  path: CameraPath;
  /** False while a drawing tool is armed, so a stroke can start over the bubble. */
  interactive: boolean;
  selected: boolean;
  /**
   * The dropped place a card is asking about: the bubble stays there until it is null again,
   * when it goes back to where the scene has it.
   */
  dropAt: Point | null;
  /** A click. `sourceTime` is the frame it happened on, to pick the override in force. */
  onSelect(sourceTime: number): void;
  /** The drag ended: the clamped normalized centre, once, over the frame at `sourceTime`. */
  onDrop(position: Point, sourceTime: number): void;
  /** The bubble is held (a drag started) or let go: the editor's paused marks step aside. */
  onHeldChange?(held: boolean): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const sync = useWebcamSync({
    videoRef,
    src,
    startOffsetMs,
    recordings,
    webcam,
    endSeconds,
    path,
    cameraEnabled,
    frame,
    hidden,
  });
  const { boxRef, lastTime, drawn, held, resync } = sync;
  const drag = useRef<{
    x: number;
    y: number;
    from: Point;
    w: number;
    h: number;
    center: Point;
    /** Past the click slop at some point: coming back to the start does not undo the drag. */
    crossed: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  // The bubble is held for the page once it has moved past the click slop: a plain click
  // (which only selects) must not pause a playing video or hide the marks.
  const [moved, setMoved] = useState(false);
  const heldChange = useRef(onHeldChange);
  heldChange.current = onHeldChange;
  useEffect(() => {
    heldChange.current?.(moved);
  }, [moved]);

  // Before paint, so a drop never shows the old place for a frame: the held place follows
  // the card's, and the scene's own place comes back when the card is gone or answered.
  useLayoutEffect(() => {
    held.current = dropAt;
    resync();
    // Keyed on what changes the place; `resync` is a fresh closure on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropAt, webcam]);

  // Same abort contract as the camera box: a drag can end without a pointerup. The bubble
  // goes back to the card's dropped place when one is open, else to the scene's.
  const abort = (): void => {
    if (!drag.current) return;
    drag.current = null;
    held.current = dropAt;
    setDragging(false);
    setMoved(false);
    resync();
  };

  return (
    <div className={styles.slot} data-testid="webcam-slot">
      <div
        {...uiArea("editorVideo.webcam")}
        ref={boxRef}
        className={styles.bubble}
        style={{ display: "none" }}
        data-testid="webcam-layer"
        // A button, like the repo's other clickable non-<button> elements: activating it
        // selects the layer (the inspector's Webcam section), dragging moves it. Enter and
        // Space select from the keyboard and stop there, so Space does not also play.
        role="button"
        tabIndex={interactive ? 0 : -1}
        aria-label={t("webcamLayerAria")}
        aria-pressed={selected}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          onSelect(lastTime.current);
        }}
        data-interactive={String(interactive)}
        data-selected={String(selected)}
        data-dragging={String(dragging)}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.stopPropagation();
          const slot = boxRef.current?.parentElement?.getBoundingClientRect();
          const from = drawn.current;
          if (!slot || slot.width === 0 || slot.height === 0 || !from) {
            onSelect(lastTime.current);
            return;
          }
          event.currentTarget.setPointerCapture?.(event.pointerId);
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            from: from.center,
            w: slot.width,
            h: slot.height,
            center: from.center,
            crossed: false,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          const box = drawn.current?.box;
          if (!d || box === undefined) return;
          const next = clampWebcamCenter(
            {
              x: d.from.x + (event.clientX - d.x) / d.w,
              y: d.from.y + (event.clientY - d.y) / d.h,
            },
            box,
            frame,
          );
          d.center = next;
          held.current = next;
          if (Math.hypot(event.clientX - d.x, event.clientY - d.y) >= CLICK_SLOP_PX) {
            d.crossed = true;
            setMoved(true);
          }
          resync();
        }}
        onPointerUp={(event) => {
          const d = drag.current;
          if (!d) return;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          const click =
            !d.crossed && Math.hypot(event.clientX - d.x, event.clientY - d.y) < CLICK_SLOP_PX;
          abort();
          if (click) onSelect(lastTime.current);
          else onDrop(d.center, lastTime.current);
        }}
        onPointerCancel={abort}
        onLostPointerCapture={abort}
      >
        <WebcamMedia sync={sync} src={src} />
      </div>
    </div>
  );
}
