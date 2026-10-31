import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { LocalRecording } from "@shared/types/library-storage";
import { captureException } from "@renderer/features/analytics";
import type { LibraryVideo } from "@renderer/features/library/types";
import type { VideoExportChoice } from "@renderer/features/video-editor/components/export-sheet";
import { WHOLE_RECORDING_FINGERPRINT } from "@renderer/features/video-editor/export/export-reuse";
import {
  isVideoExportBusy,
  showExportBusyToast,
} from "@renderer/features/video-editor/export/export-runner";
import { probeSource, type SourceProbe } from "@renderer/features/video-editor/export/probe-source";
import { useVideoExport } from "@renderer/features/video-editor/export/use-video-export";
import { createSlideAssetStore } from "@renderer/features/video-editor/slide-assets";
import { initialScene } from "@renderer/features/video-editor/scene";

/** A local recording: the only kind Prepare makes copies of (no screenshots, no GIFs). */
export type PreparableVideo = LibraryVideo & { id: string };

/** The library item as a preparable recording, or null (cloud-only, a screenshot, a GIF). */
export function asPreparable(video: LibraryVideo | undefined): PreparableVideo | null {
  return video && video.id !== null && video.kind === "recording"
    ? { ...video, id: video.id }
    : null;
}

/** A probe the presets can work with: a picture and a duration. */
export function isUsableProbe(probe: SourceProbe | null): probe is SourceProbe {
  return probe !== null && probe.width > 0 && probe.height > 0 && probe.durationSec > 0;
}

export type ProbeState =
  | { status: "idle" | "loading"; probe: null }
  | { status: "ready"; probe: SourceProbe }
  | { status: "error"; probe: null };

/**
 * Reads the recording's size, frame rate and duration from the file (container metadata and a
 * few packets): there is no `<video>` to ask on these pages. Re-reads when the id changes.
 */
export function useSourceProbe(videoId: string | null): ProbeState {
  const [state, setState] = useState<{ id: string | null; probe: ProbeState }>({
    id: null,
    probe: { status: "idle", probe: null },
  });
  useEffect(() => {
    if (!videoId) return;
    let alive = true;
    setState({ id: videoId, probe: { status: "loading", probe: null } });
    void probeSource(videoId).then((result) => {
      if (!alive) return;
      setState({
        id: videoId,
        probe: isUsableProbe(result)
          ? { status: "ready", probe: result }
          : { status: "error", probe: null },
      });
    });
    return () => {
      alive = false;
    };
  }, [videoId]);
  // A probe belongs to one file: a stale one reads as loading while the next is read.
  if (!videoId) return { status: "idle", probe: null };
  return state.id === videoId ? state.probe : { status: "loading", probe: null };
}

export interface PrepareCopyInput {
  video: PreparableVideo;
  probe: SourceProbe;
  choice: VideoExportChoice;
  /** The copy landed in the library. */
  onSaved?(recording: LocalRecording): void;
}

/**
 * Prepare (NIW2-578, formerly Share, NIW2-218): a copy of the whole recording for one
 * destination. It runs the SAME export worker as the editor with a trivial plan — one clip over
 * the whole file, no overlays, no slides, no zoom — so there is no second pipeline, and the
 * copy is a new library item derived from the recording (ADR 0003: the recording itself is
 * never touched).
 *
 * `start` returns false, after the "already exporting" toast, while another export runs: one
 * at a time. Otherwise the export runs in the background (export-runner): the progress and
 * ready cards take over, and leaving the page does not stop it.
 */
export function usePrepareCopy(): { start(input: PrepareCopyInput): boolean } {
  const tEditor = useTranslations("videoEditor");
  const videoExport = useVideoExport();
  const { start: startExport } = videoExport;
  const start = useCallback(
    ({ video, probe, choice, onSaved }: PrepareCopyInput): boolean => {
      if (isVideoExportBusy()) {
        showExportBusyToast(tEditor);
        return false;
      }
      void startExport({
        scene: initialScene(probe.durationSec),
        sourceId: video.id,
        title: video.title,
        derivedFromAssetId: video.assetId,
        sourceSizeBytes: video.fileSizeBytes,
        videoWidth: probe.width,
        videoHeight: probe.height,
        previewWidth: probe.width,
        slideAssets: createSlideAssetStore(),
        cameraPath: null,
        presetId: choice.presetId,
        framing: choice.framing,
        sourceInfo: probe,
        fingerprint: WHOLE_RECORDING_FINGERPRINT,
        onSaved: (recording) => {
          try {
            onSaved?.(recording);
          } catch (error) {
            captureException(error, { context: "prepare-saved" });
          }
        },
      });
      return true;
    },
    [startExport, tEditor],
  );
  return { start };
}
