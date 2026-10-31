/**
 * The webcam layer in the preview (ADR 0038, spec § 6): a second <video> playing the
 * recording's webcam file, drawn in PreviewStage's `webcam` slot — untransformed, so with a
 * zoom active the face stays in its corner — and kept in step with the main video.
 *
 * Per frame, from the main video's frame clock and without React re-renders (like the
 * camera box): `webcamAt` picks the layout in force (null inside a hidden segment),
 * `webcamRect` places it in the output frame with the camera path's scale for "shrink
 * during zoom", and `webcam-sync` decides visibility (the file's own first and last frame)
 * and whether the element drifted past 80 ms and needs a seek. Play/pause/rate mirror the
 * main element.
 *
 * Dragging the bubble reports normalized centres already clamped inside the frame, with
 * the begin/move/end contract the scene history needs for one undo step per drag.
 *
 * `WebcamPlaybackLayer` is the same drawing without the editing: the Library's original
 * player puts the face where it was recorded with it.
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
import { webcamHasFrameAt, webcamResyncTarget, webcamTimeFor } from "../webcam/webcam-sync";
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

/** What both layers draw from: the main video's clock and the webcam's layout over time. */
interface WebcamSyncInput {
  /** The MAIN video: its frame clock drives the layer and its play/pause/rate the webcam's. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Webcam time 0 − screen time 0 (ADR 0037): webcam time = t − startOffsetMs / 1000. */
  startOffsetMs: number;
  webcam: WebcamScene;
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
  startOffsetMs,
  webcam,
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
  const drawn = useRef<{ center: Point; side: number } | null>(null);

  const apply = (t: number): void => {
    lastTime.current = t;
    const box = boxRef.current;
    const cam = camRef.current;
    if (!box || !cam) return;
    const main = videoRef.current;
    // A faster or slower main video would otherwise drift past the resync threshold on
    // every frame and turn the face into a series of seeks.
    if (main && cam.playbackRate !== main.playbackRate) cam.playbackRate = main.playbackRate;
    const layout = hidden ? null : webcamAt({ webcam }, t);
    const webcamTime = webcamTimeFor(t, startOffsetMs);
    const scale = cameraEnabled && path ? cameraAt(path, t).scale : 1;
    const rect =
      layout && webcamHasFrameAt(webcamTime, cam.duration)
        ? webcamRect(layout, frame, scale)
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
    if (!cam.seeking) {
      const seekTo = webcamResyncTarget(cam.currentTime, webcamTime, cam.duration);
      if (seekTo !== null) cam.currentTime = seekTo;
    }
    if (main && !main.paused && cam.paused) safePlay(cam);
    if (main?.paused && !cam.paused) safePause(cam);
  };

  const trigger = useMemo(
    () => ({ webcam, path, cameraEnabled, frame, hidden, startOffsetMs }),
    [webcam, path, cameraEnabled, frame, hidden, startOffsetMs],
  );
  useVideoFrameClock(videoRef, apply, trigger);

  // Play, pause and a rate change land between frames (a paused element presents no frame),
  // so mirror them as they happen. A play outside the file is undone by the next apply().
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    const main = videoRef.current;
    if (!main) return;
    const sync = (): void => applyRef.current(main.currentTime);
    main.addEventListener("play", sync);
    main.addEventListener("pause", sync);
    main.addEventListener("ratechange", sync);
    return () => {
      main.removeEventListener("play", sync);
      main.removeEventListener("pause", sync);
      main.removeEventListener("ratechange", sync);
    };
  }, [videoRef]);

  const resync = (): void => apply(videoRef.current?.currentTime ?? lastTime.current);
  return { boxRef, clipRef, camRef, lastTime, drawn, resync };
}

/** The webcam file inside the bubble's shape: the part both layers render the same way. */
function WebcamMedia({
  sync,
  src,
}: {
  sync: ReturnType<typeof useWebcamSync>;
  src: string;
}): React.JSX.Element {
  return (
    <div ref={sync.clipRef} className={styles.clip}>
      <video
        ref={sync.camRef}
        className={styles.video}
        src={src}
        muted
        playsInline
        preload="auto"
        data-testid="webcam-video"
        onLoadedMetadata={sync.resync}
        onSeeked={sync.resync}
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
  src,
  ...input
}: Omit<WebcamSyncInput, "path" | "cameraEnabled" | "hidden"> & {
  /** The take's webcam URL, built with `mediaUrl("webcam", id)`. */
  src: string;
}): React.JSX.Element {
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
}: Omit<WebcamSyncInput, "path"> & {
  /** The take's webcam URL, built with `mediaUrl("webcam", id)`. */
  src: string;
  path: CameraPath;
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
  const sync = useWebcamSync({
    videoRef,
    startOffsetMs,
    webcam,
    path,
    cameraEnabled,
    frame,
    hidden,
  });
  const { boxRef, lastTime, drawn } = sync;
  const drag = useRef<{ x: number; y: number; from: Point; w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);

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
        <WebcamMedia sync={sync} src={src} />
      </div>
    </div>
  );
}
