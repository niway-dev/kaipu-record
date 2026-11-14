import { useCallback } from "react";
import type { RecordingCapture } from "@shared/recording-capture";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import { composeJoin } from "./compose-join";
import { frameCursorTrack } from "./cursor/axis-cursor-track";
import { loadCursorTrackBestEffort } from "./joined-library";
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

/**
 * The join operation (ADR 0058) the UI will call: `joinRecordingAt(recording, t)` puts the
 * recording into the Clips sequence at the clip boundary nearest timeline time `t`. The media it
 * needs, the cursor track and the webcam meta, is read FIRST, so the scene changes once, with the
 * zooms and the webcam already in it. The track is mapped into the frame's coordinates (the
 * opened recording's `frameAspect`) first, so the zooms are detected where the pointer is on the frame. The rename hold taken to resolve the recording's current id
 * is released again here: once the scene lists the new source, `useJoinedRecordings` takes its
 * own and keeps it for as long as the source is in the scene.
 */
export function useJoinRecording(
  controller: VideoSceneController,
  primaryDuration: number,
  frameAspect: number,
): (recording: JoinableRecording, t: number) => Promise<JoinRecordingResult> {
  const controllerRef = useLatest(controller);
  return useCallback(
    async (recording, t) => {
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
      current.commit(
        composeJoin(
          current.scene,
          primaryDuration,
          {
            assetId: recording.assetId,
            title: recording.title,
            durationSeconds: recording.durationSeconds,
            width,
            height,
          },
          t,
          frameTrack,
          recording.webcam ?? null,
        ),
      );
      return "joined";
    },
    [controllerRef, primaryDuration, frameAspect],
  );
}
