/**
 * The joined recordings a GIF export or a frame capture reads (ADR 0058): which of the scene's
 * joined recordings the plan's clips use, whether each can be read, and a per-id blob cache.
 * The MP4 runner does the same inline (export-runner.ts); the worker side is gif-worker.ts.
 */
import { mediaUrl } from "@renderer/lib/media-url";
import type { VideoScene } from "../scene";
import type { ExportJoinedRecording } from "./export-runner";
import type { RenderSegment } from "./export-plan";
import { recordingsUsed } from "./export-recordings";
import { fetchWebcamTrack } from "./webcam-fetch";
import type { ExportStartMessage, WebcamTrackMessage } from "./export-messages";
import type { WebcamScene } from "../webcam/webcam-model";

export interface UsedJoinedRecording {
  entry: ExportJoinedRecording;
  /** Axis second of the recording's second 0. */
  offset: number;
}

export type UsedJoined =
  | { ok: true; used: UsedJoinedRecording[] }
  | { ok: false; reason: "missing"; title: string }
  | { ok: false; reason: "loading" };

/** The joined recordings the plan's clips read, in first-use order, or why one cannot be read. */
export function usedJoinedRecordings(
  plan: { segments: readonly RenderSegment[] },
  scene: Pick<VideoScene, "sources">,
  joined: readonly ExportJoinedRecording[],
): UsedJoined {
  const used: UsedJoinedRecording[] = [];
  for (const sourceId of recordingsUsed(plan)) {
    if (sourceId === null) continue;
    const entry = joined.find((j) => j.sourceId === sourceId);
    const sceneSource = scene.sources?.find((s) => s.id === sourceId);
    if (!entry || entry.status === "missing" || !sceneSource) {
      return {
        ok: false,
        reason: "missing",
        title: entry?.title ?? sceneSource?.title ?? sourceId,
      };
    }
    if (entry.status === "loading" || entry.id === null) return { ok: false, reason: "loading" };
    used.push({ entry, offset: sceneSource.offset });
  }
  return { ok: true, used };
}

/** Recording files fetched once per vault id; a failed fetch is never cached. */
export function createRecordingCache(label: string): {
  blob(id: string): Promise<Blob>;
} {
  const blobs = new Map<string, Promise<Blob>>();
  return {
    blob(id) {
      const cached = blobs.get(id);
      if (cached) return cached;
      const blob = fetch(mediaUrl("recording", id)).then((r) => {
        // An error page is not the recording: fail, so it is not cached as one.
        if (!r.ok) throw new Error(`${label}: source fetch failed (${r.status})`);
        return r.blob();
      });
      blobs.set(id, blob);
      blob.catch(() => {
        if (blobs.get(id) === blob) blobs.delete(id);
      });
      return blob;
    },
  };
}

/**
 * The recording under the playhead cannot be read; `message` is already worded for the user
 * (it names the recording), so the page shows it instead of the generic capture error.
 */
export class RecordingUnavailableError extends Error {}

/** A used joined recording's file could not be read; `title` names it for the user. */
export class JoinedRecordingUnreadable extends Error {
  constructor(
    readonly title: string,
    cause: unknown,
  ) {
    super(`joined recording "${title}" could not be read`, { cause });
  }
}

/**
 * The worker's `joined` list: each used recording's file (by its CURRENT vault id) and its
 * webcam. A webcam that cannot be read only loses that recording's face (`onWebcamError`).
 */
export async function fetchJoinedFiles(
  used: readonly UsedJoinedRecording[],
  layer: WebcamScene | null,
  recordings: { blob(id: string): Promise<Blob> },
  onWebcamError: (error: unknown) => void,
): Promise<ExportStartMessage["joined"]> {
  const files: ExportStartMessage["joined"] = [];
  for (const { entry, offset } of used) {
    let blob: Blob;
    try {
      blob = await recordings.blob(entry.id!);
    } catch (error) {
      throw new JoinedRecordingUnreadable(entry.title, error);
    }
    const webcam: WebcamTrackMessage | null = await fetchWebcamTrack(
      entry.id!,
      layer,
      entry.webcam,
      onWebcamError,
    );
    files.push({ sourceId: entry.sourceId, offset, blob, webcam });
  }
  return files;
}
