/**
 * What happens when the bubble is dropped (camera parts, drag-first): inside a part the drop
 * sets that part's position (one undo step); anywhere else it opens a card, and the scene
 * stays UNCHANGED until the user answers it. The answers: a new part at the playhead holding
 * the dropped place, the original position moved, or nothing (the bubble goes back).
 *
 * The card belongs to one moment: seeking, playing, selecting something else, undo, redo and
 * Escape all close it like its Close button. Every handler reads `controller.scene`, never a
 * scene captured at render time.
 */
import { useCallback, useEffect, useState } from "react";
import { useLatest } from "../use-latest";
import type { EditorSelection, SelectionKind } from "../editor-selection";
import { WEBCAM_LAYER_SELECTION } from "../editor-selection";
import type { VideoScene } from "../scene";
import type { VideoSceneController } from "../use-video-scene";
import { createWebcamPart, setWebcamLayout, webcamPartRoom } from "./webcam-edits";
import { type FrameSize, webcamStateRect } from "./webcam-layout";
import { webcamEndSeconds, webcamOverrideAt, webcamStateAt } from "./webcam-model";
import type { WebcamEditing } from "./use-webcam-editing";

type Point = { x: number; y: number };

export interface WebcamPendingDrop {
  /** The dropped centre, normalized and clamped inside the frame. */
  position: Point;
  /** The source time the bubble was dropped on, where a new part would start. */
  sourceTime: number;
  /** Where the bubble is at that time, in frame pixels: the route's start ("Now"). */
  now: Point;
  /** The bubble's box, in frame pixels. */
  box: { width: number; height: number };
  /** The free window a new part would take, or null with no room (the choice is disabled). */
  room: { start: number; end: number } | null;
}

export interface WebcamDrop {
  card: WebcamPendingDrop | null;
  /** The layer's `onDrop`. */
  drop(position: Point, sourceTime: number): void;
  /** "Only for this part". */
  answerPart(): void;
  /** "For the whole video". */
  answerWhole(): void;
  /** Close, and everything that closes it: nothing changes. */
  close(): void;
}

/** The bubble's centre and box at `t` in frame pixels, as the preview draws it. */
function bubbleAt(
  scene: VideoScene,
  t: number,
  frame: FrameSize,
  scale: number,
  endSeconds: number | undefined,
): { now: Point; box: { width: number; height: number } } | null {
  const state = webcamStateAt(scene, t, webcamEndSeconds(endSeconds));
  const rect = state && webcamStateRect(state, frame, scale);
  if (!rect) return null;
  return {
    now: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    box: { width: rect.width, height: rect.height },
  };
}

export function useWebcamDrop({
  controller,
  edits,
  sourceDuration,
  frame,
  cameraScaleAt,
  select,
  timelineTime,
  playing,
  selection,
}: {
  controller: VideoSceneController;
  edits: Pick<WebcamEditing, "commitLayout">;
  sourceDuration: number;
  frame: FrameSize;
  /** The camera path's scale at a source time: the bubble's size follows "shrink during zoom". */
  cameraScaleAt(t: number): number;
  select(kind: SelectionKind, id: string): void;
  /** What closes the card when it changes. */
  timelineTime: number;
  playing: boolean;
  selection: EditorSelection;
}): WebcamDrop {
  const [card, setCard] = useState<WebcamPendingDrop | null>(null);
  const latest = useLatest({
    controller,
    edits,
    sourceDuration,
    frame,
    cameraScaleAt,
    select,
    card,
  });

  const close = useCallback(() => setCard(null), []);

  // The card is for this scene, this moment and this selection, and for a paused editor.
  useEffect(() => {
    setCard(null);
  }, [timelineTime, playing, selection, controller.scene]);

  useEffect(() => {
    if (!card) return;
    // Capture phase, and stopped: the page's own Escape (clear the selection) must not also run.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      event.preventDefault();
      setCard(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [card]);

  const drop = useCallback(
    (position: Point, sourceTime: number) => {
      const { controller, edits, sourceDuration, frame, cameraScaleAt, select } = latest.current;
      if (controller.interacting) return;
      const scene = controller.scene;
      const part = scene.webcam && webcamOverrideAt(scene.webcam, sourceTime);
      if (part) {
        edits.commitLayout({ position }, sourceTime);
        select("webcam", part.id);
        return;
      }
      const where = bubbleAt(scene, sourceTime, frame, cameraScaleAt(sourceTime), sourceDuration);
      if (!where) return;
      setCard({
        position,
        sourceTime,
        ...where,
        room: webcamPartRoom(scene, sourceTime, sourceDuration),
      });
    },
    [latest],
  );

  const answerPart = useCallback(() => {
    const { controller, sourceDuration, select, card } = latest.current;
    if (!card || controller.interacting) return;
    const { scene, id } = createWebcamPart(
      controller.scene,
      { at: card.sourceTime, position: card.position },
      sourceDuration,
    );
    setCard(null);
    if (!id) return;
    controller.commit(scene);
    select("webcam", id);
  }, [latest]);

  const answerWhole = useCallback(() => {
    const { controller, select, card } = latest.current;
    if (!card || controller.interacting) return;
    setCard(null);
    controller.commit(setWebcamLayout(controller.scene, { position: card.position }));
    select("webcam", WEBCAM_LAYER_SELECTION);
  }, [latest]);

  return { card, drop, answerPart, answerWhole, close };
}
