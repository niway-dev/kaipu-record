/**
 * What happens when the bubble is dropped (camera parts, drag-first): inside a part the drop
 * sets that part's position (one undo step); anywhere else it opens a card, and the scene
 * stays UNCHANGED until the user answers it. The answers: a new part at the playhead holding
 * the dropped place, the original position moved, or nothing (the bubble goes back).
 *
 * The card belongs to one moment: seeking, playing, selecting something else, undo, redo and
 * Escape all close it like its Close button. The playhead leaving the moment is what counts as
 * seeking: the last time update after the pause that picking the bubble up causes lands on
 * the very frame the drop was made on, and must not close the card. Every handler reads `controller.scene`, never a
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
import {
  type WebcamSegment,
  webcamEndSeconds,
  webcamOverrideAt,
  webcamStateAt,
} from "./webcam-model";
import type { WebcamEditing } from "./use-webcam-editing";

type Point = { x: number; y: number };

/**
 * How far the playhead may sit from the card's moment, in seconds, and still count as being on
 * it. The pause that picking the bubble up causes reports the frame the video stopped on, up
 * to one rendered frame away from the time the drop recorded; a real seek is further than that.
 */
export const CARD_MOMENT_TOLERANCE_SECONDS = 0.05;

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

/**
 * Where the card's route starts, in frame pixels: the bubble's centre and box as "Only for this
 * part" will begin its slide. That is NOT always where the bubble is drawn at `t`: a drop
 * during the return slide of the part before finds the bubble halfway back, but a new part
 * that does not touch it slides from the whole-video position. So the origin is read from the
 * scene the answer would commit, at its first instant, and from the drawn bubble only when no
 * part fits here.
 */
function bubbleAt(
  scene: VideoScene,
  t: number,
  position: Point,
  frame: FrameSize,
  scale: number,
  endSeconds: number | undefined,
): { now: Point; box: { width: number; height: number } } | null {
  const end = webcamEndSeconds(endSeconds);
  const created = end === undefined ? null : createWebcamPart(scene, { at: t, position }, end);
  const hypothetical = created?.id ? created.scene : scene;
  const state = webcamStateAt(hypothetical, t, end);
  const rect =
    state && webcamStateRect(created?.id ? { ...state, progress: 0 } : state, frame, scale);
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
  seekToPart,
  timelineOf,
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
  /** A part was just created: the page moves the playhead past its slide, so the bubble shows where it was dropped. */
  seekToPart?(part: WebcamSegment): void;
  /** The timeline time of a source time (null when no clip shows it): where the card's moment is. */
  timelineOf?(sourceTime: number): number | null;
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
    seekToPart,
    timelineOf,
    card,
  });

  const close = useCallback(() => setCard(null), []);

  // The card is for this scene, this selection and a paused editor.
  useEffect(() => {
    setCard(null);
  }, [playing, selection, controller.scene]);

  // ...and for this moment: it closes when the playhead leaves it, not on every time update.
  useEffect(() => {
    setCard((open) => {
      if (!open) return open;
      const moment = latest.current.timelineOf?.(open.sourceTime) ?? null;
      const onIt =
        moment !== null && Math.abs(timelineTime - moment) <= CARD_MOMENT_TOLERANCE_SECONDS;
      return onIt ? open : null;
    });
  }, [timelineTime, latest]);

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
      const where = bubbleAt(
        scene,
        sourceTime,
        position,
        frame,
        cameraScaleAt(sourceTime),
        sourceDuration,
      );
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
    const { controller, sourceDuration, select, seekToPart, card } = latest.current;
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
    const part = scene.webcam?.segments.find((s) => s.id === id);
    if (part) seekToPart?.(part);
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
