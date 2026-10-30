/**
 * The webcam layer in the preview (ADR 0033, spec § 6): a second <video> playing the
 * recording's webcam file, drawn in PreviewStage's `webcam` slot — untransformed, so with a
 * zoom active the face stays in its corner — and kept in step with the main video.
 *
 * Per frame, from the main video's frame clock and without React re-renders (like the
 * camera box): `webcamAt` picks the layout in force (null inside a hidden segment),
 * `webcamRect` places it in the output frame with the camera path's scale for "shrink
 * during zoom", and `webcam-sync` decides visibility (the file's own first and last frame)
 * and whether the element drifted past 80 ms and needs a seek. While the main video plays, a
 * seek aims ahead by the last seek's measured duration, so it lands where the screen will be.
 * Play/pause mirror the main element, and the webcam also pauses while the main one waits
 * for data, so the face does not run ahead of a buffering screen.
 *
 * Dragging the bubble reports normalized centres already clamped inside the frame, with
 * the begin/move/end contract the scene history needs for one undo step per drag.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { framingTransform } from "@shared/camera-bubble";
import { useVideoFrameClock } from "../use-video-frame-clock";
import { type CameraPath, cameraAt } from "../zoom/camera-path";
import {
  clampWebcamCenter,
  type FrameSize,
  webcamClipPath,
  webcamRect,
} from "../webcam/webcam-layout";
import { webcamAt, type WebcamScene } from "../webcam/webcam-model";
import {
  webcamHasFrameAt,
  webcamResyncTarget,
  webcamSeekLead,
  webcamTimeFor,
} from "../webcam/webcam-sync";
import styles from "./webcam-layer.module.css";

type Point = { x: number; y: number };

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

export function WebcamLayer({
  videoRef,
  src,
  startOffsetMs,
  webcam,
  path,
  cameraEnabled,
  frame,
  hidden,
  interactive,
  selected,
  onSelect,
  onBegin,
  onMove,
  onEnd,
}: {
  /** The MAIN video: its frame clock drives the layer and its play/pause the webcam's. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** `kaipu-media://webcam/<id>`. */
  src: string;
  /** Webcam time 0 − screen time 0 (ADR 0032): webcam time = t − startOffsetMs / 1000. */
  startOffsetMs: number;
  webcam: WebcamScene;
  path: CameraPath;
  /** False when the preview shows the unzoomed frame (zoom-edit view, privacy editing). */
  cameraEnabled: boolean;
  /** The output frame the layout is relative to; in the preview, the decoded source size. */
  frame: FrameSize;
  /** Hold-to-see-original and slides: nothing of the webcam shows. */
  hidden: boolean;
  /** False while a drawing tool is armed, so a stroke can start over the bubble. */
  interactive: boolean;
  selected: boolean;
  /** `sourceTime` is the frame the bubble was grabbed on, to pick the override in force. */
  onSelect(sourceTime: number): void;
  onBegin(): void;
  /** `sourceTime` is the frame the drag happened over, for an override in force there. */
  onMove(center: Point, sourceTime: number): void;
  onEnd(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const clipRef = useRef<HTMLDivElement | null>(null);
  const camRef = useRef<HTMLVideoElement | null>(null);
  const lastTime = useRef(0);
  // Where the bubble is drawn right now: the drag starts from it.
  const drawn = useRef<{ center: Point; side: number } | null>(null);
  const drag = useRef<{ x: number; y: number; from: Point; w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // When the webcam's seek in flight started (performance.now()), and how long the last one
  // took, in seconds: the lead the next seek during playback is given.
  const seekStartedAt = useRef<number | null>(null);
  const lastSeekSeconds = useRef(0);
  // The main video is playing but out of data (`waiting`); cleared on `playing`.
  const mainWaiting = useRef(false);

  const apply = (t: number): void => {
    lastTime.current = t;
    const box = boxRef.current;
    const cam = camRef.current;
    if (!box || !cam) return;
    const layout = hidden ? null : webcamAt({ webcam }, t);
    const webcamTime = webcamTimeFor(t, startOffsetMs);
    const rect =
      layout && webcamHasFrameAt(webcamTime, cam.duration)
        ? webcamRect(layout, frame, cameraEnabled ? cameraAt(path, t).scale : 1)
        : null;
    if (!layout || !rect) {
      box.style.display = "none";
      drawn.current = null;
      if (!cam.paused) safePause(cam);
      return;
    }
    box.style.display = "";
    box.style.left = `${(rect.x / frame.width) * 100}%`;
    box.style.top = `${(rect.y / frame.height) * 100}%`;
    box.style.width = `${(rect.size / frame.width) * 100}%`;
    box.style.height = `${(rect.size / frame.height) * 100}%`;
    box.dataset.shadow = String(layout.shadow);
    if (clipRef.current) clipRef.current.style.clipPath = webcamClipPath(layout.shape);
    cam.style.transform = framingTransform(layout.framing, layout.mirrored);
    drawn.current = {
      center: {
        x: (rect.x + rect.size / 2) / frame.width,
        y: (rect.y + rect.size / 2) / frame.height,
      },
      side: rect.size,
    };
    // While a seek is in flight, currentTime already reads the pending target and the main
    // clock keeps moving: re-seeking on every frame would cancel each seek with the next one
    // and freeze the bubble after a cut or a scrub. Wait for `seeked` (below), then catch up.
    const main = videoRef.current;
    if (!cam.seeking) {
      const seekTo = webcamResyncTarget(cam.currentTime, webcamTime, cam.duration);
      if (seekTo !== null) {
        // The lead is for a moving clock: a waiting main video is not paused but holds still.
        const moving = !!main && !main.paused && !mainWaiting.current;
        const lead = webcamSeekLead(moving, lastSeekSeconds.current);
        const end = Number.isFinite(cam.duration) && cam.duration > 0 ? cam.duration : Infinity;
        seekStartedAt.current = performance.now();
        cam.currentTime = Math.min(seekTo + lead, end);
      }
    }
    if (main && !main.paused && cam.paused && !mainWaiting.current) safePlay(cam);
    if (main?.paused && !cam.paused) safePause(cam);
  };

  const trigger = useMemo(
    () => ({ webcam, path, cameraEnabled, frame, hidden, startOffsetMs }),
    [webcam, path, cameraEnabled, frame, hidden, startOffsetMs],
  );
  useVideoFrameClock(videoRef, apply, trigger);

  // Play and pause land between frames (a paused element presents no frame), so mirror
  // them as they happen. A play outside the file is undone by the next apply().
  const applyRef = useRef(apply);
  applyRef.current = apply;
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
    main.addEventListener("play", sync);
    main.addEventListener("pause", sync);
    main.addEventListener("waiting", waiting);
    main.addEventListener("stalled", stalled);
    main.addEventListener("playing", resume);
    return () => {
      main.removeEventListener("play", sync);
      main.removeEventListener("pause", sync);
      main.removeEventListener("waiting", waiting);
      main.removeEventListener("stalled", stalled);
      main.removeEventListener("playing", resume);
    };
  }, [videoRef]);

  // Same abort contract as the camera box: a drag can end without a pointerup.
  const abort = (): void => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    onEnd();
  };

  return (
    <div className={styles.slot} data-testid="webcam-slot">
      <div
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
          onSelect(lastTime.current);
          const slot = boxRef.current?.parentElement?.getBoundingClientRect();
          const from = drawn.current;
          if (!slot || slot.width === 0 || slot.height === 0 || !from) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            from: from.center,
            w: slot.width,
            h: slot.height,
          };
          setDragging(true);
          onBegin();
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          const side = drawn.current?.side;
          if (!d || side === undefined) return;
          const next = clampWebcamCenter(
            {
              x: d.from.x + (event.clientX - d.x) / d.w,
              y: d.from.y + (event.clientY - d.y) / d.h,
            },
            side,
            frame,
          );
          onMove(next, lastTime.current);
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          abort();
        }}
        onPointerCancel={abort}
        onLostPointerCapture={abort}
      >
        <div ref={clipRef} className={styles.clip}>
          <video
            ref={camRef}
            className={styles.video}
            src={src}
            muted
            playsInline
            preload="auto"
            data-testid="webcam-video"
            onLoadedMetadata={() => apply(videoRef.current?.currentTime ?? lastTime.current)}
            onSeeked={() => {
              if (seekStartedAt.current !== null) {
                lastSeekSeconds.current = (performance.now() - seekStartedAt.current) / 1000;
                seekStartedAt.current = null;
              }
              apply(videoRef.current?.currentTime ?? lastTime.current);
            }}
          />
        </div>
      </div>
    </div>
  );
}
