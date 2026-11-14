import { useCallback, useLayoutEffect, useRef } from "react";
import type { RecordingCapture } from "@shared/recording-capture";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import { composeJoin } from "./compose-join";
import { frameCursorTrack } from "./cursor/axis-cursor-track";
import { loadCursorTrackBestEffort } from "./joined-library";
import type { VideoScene } from "./scene";
import { useLatest } from "./use-latest";
import type { VideoSceneController } from "./use-video-scene";

/** What `joinRecordingAt` needs from a Library recording (a `LibraryVideo` has all of it). */
export interface JoinableRecording {
  /** Local filename id; null for a cloud-only recording, which cannot be joined. */
  id: string | null;
  assetId: string;
  title: string;
  durationSeconds: number;
  capture?: RecordingCapture | null;
  webcam?: WebcamTrackMeta | null;
}

/**
 * `joined`: one new scene is committed (one undo step). `missing`: the recording has no local
 * copy, or main refused to resolve it; nothing changed. `busy`: a drag owns the scene, so the
 * commit would be dropped; nothing changed.
 */
export type JoinRecordingResult = "joined" | "missing" | "busy";

/** A timeline second, or how to find it on the scene the join composes from. */
export type JoinTarget = number | ((scene: VideoScene) => number);

/**
 * The join operation (ADR 0058) the UI will call: `joinRecordingAt(recording, t)` puts the
 * recording into the Clips sequence at the clip boundary nearest timeline time `t`. The media it
 * needs, the cursor track and the webcam meta, is read FIRST, so the scene changes once, with the
 * zooms and the webcam already in it. The track is mapped into the frame's coordinates (the
 * opened recording's `frameAspect`) first, so the zooms are detected where the pointer is on the
 * frame. The rename hold taken to resolve the recording's current id is released again here: once
 * the scene lists the new source, `useJoinedRecordings` takes its own and keeps it for as long as
 * the source is in the scene.
 *
 * Calls run one after another: each one reads the scene after the awaits, and the previous join's
 * commit only reaches `controller.scene` once React has rendered it. The next join therefore waits
 * for that render, otherwise it would compose from the old scene and replace the first join.
 *
 * `t` is a timeline second, or a function that turns the scene the join actually composes from
 * into one (`anchoredBoundary`): a number measured when the user acted names another boundary if
 * a join queued before this one has since inserted a clip ahead of it.
 */
export function useJoinRecording(
  controller: VideoSceneController,
  primaryDuration: number,
  frameAspect: number,
): (recording: JoinableRecording, t: JoinTarget) => Promise<JoinRecordingResult> {
  const controllerRef = useLatest(controller);
  // End of the joins queued so far, and what the running one waits for after its commit.
  const tailRef = useRef<Promise<unknown>>(Promise.resolve());
  const afterCommitRef = useRef<Promise<void> | null>(null);
  const renderWaitersRef = useRef<Array<() => void>>([]);
  // Declared after useLatest: its layout effect has already refreshed controllerRef when ours runs.
  useLayoutEffect(() => {
    for (const resolve of renderWaitersRef.current.splice(0)) resolve();
  });
  useLayoutEffect(
    () => () => {
      for (const resolve of renderWaitersRef.current.splice(0)) resolve();
    },
    [],
  );
  const joinNow = useCallback(
    async (recording: JoinableRecording, t: JoinTarget): Promise<JoinRecordingResult> => {
      if (recording.id === null) return "missing";
      let heldId: string | null;
      try {
        heldId = await window.electronAPI.acquireEditorSession(recording.assetId);
      } catch {
        return "missing";
      }
      if (heldId === null) return "missing";
      let track;
      try {
        track = await loadCursorTrackBestEffort(heldId);
      } finally {
        window.electronAPI.closeEditorSession(heldId);
      }
      const width = recording.capture?.width ?? 0;
      const height = recording.capture?.height ?? 0;
      const frameTrack = frameCursorTrack(
        track ?? null,
        frameAspect,
        height > 0 ? width / height : 0,
      );
      // Read now, not before the awaits: the scene may have been edited while they ran.
      const current = controllerRef.current;
      if (current.interacting) return "busy";
      const at = typeof t === "function" ? t(current.scene) : t;
      const next = composeJoin(
        current.scene,
        primaryDuration,
        {
          assetId: recording.assetId,
          title: recording.title,
          durationSeconds: recording.durationSeconds,
          width,
          height,
        },
        at,
        frameTrack,
        recording.webcam ?? null,
      );
      current.commit(next);
      if (next !== current.scene) {
        afterCommitRef.current = new Promise<void>((resolve) => {
          renderWaitersRef.current.push(resolve);
        });
      }
      return "joined";
    },
    [controllerRef, primaryDuration, frameAspect],
  );
  return useCallback(
    (recording, t) => {
      const run = tailRef.current.then(() => {
        afterCommitRef.current = null;
        return joinNow(recording, t);
      });
      // The caller gets its result right away; only the next join waits for the render.
      tailRef.current = run.then(
        () => afterCommitRef.current,
        () => undefined,
      );
      return run;
    },
    [joinNow],
  );
}
