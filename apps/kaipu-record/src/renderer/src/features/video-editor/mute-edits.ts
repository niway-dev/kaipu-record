import { newId, type VideoScene } from "./scene";
import type { MutedRange } from "./audio-edits";

export const MUTE_LIMITS = {
  /** Length of a range added by hand at the playhead. */
  defaultSeconds: 3,
  /** Below this a range is a handle too small to grab and a silence too short to hear. */
  minSeconds: 0.25,
} as const;

/**
 * Editing operations for muted ranges — the same shape as `zoom-edits.ts`, and
 * deliberately so: add at the playhead, drag either edge, delete from the
 * inspector. A second way of drawing a range on the timeline would be a second
 * thing to learn for no gain.
 *
 * One real difference: zooms must not overlap, so adding one has to find a free
 * window and can fail with "no room". Muted ranges may overlap freely — silence
 * over silence is silence — so adding only fails when there is no recording left
 * to silence. That removes an entire failure mode rather than reimplementing it.
 */

/**
 * Add a range starting at `sourceTime`. Returns null when the playhead sits too
 * close to the end for even the minimum length to fit.
 */
export function addMuteAt(
  scene: VideoScene,
  sourceTime: number,
  sourceDurationSeconds: number,
): { scene: VideoScene; id: string } | null {
  const start = Math.max(0, Math.min(sourceTime, sourceDurationSeconds));
  const end = Math.min(start + MUTE_LIMITS.defaultSeconds, sourceDurationSeconds);
  if (end - start < MUTE_LIMITS.minSeconds) return null;

  const range: MutedRange = { id: newId(), sourceStart: start, sourceEnd: end };
  return {
    id: range.id,
    scene: {
      ...scene,
      mutedRanges: [...scene.mutedRanges, range].sort((a, b) => a.sourceStart - b.sourceStart),
    },
  };
}

/**
 * Move one edge of a range to `to`, clamped to the recording and to the minimum
 * length. Neighbours are ignored: a range may be dragged across another.
 */
export function dragMuteEdge(
  scene: VideoScene,
  id: string,
  edge: "start" | "end",
  to: number,
  sourceDurationSeconds: number,
): VideoScene {
  const target = scene.mutedRanges.find((r) => r.id === id);
  if (!target) return scene;

  const clamped = Math.max(0, Math.min(to, sourceDurationSeconds));
  const next =
    edge === "start"
      ? {
          sourceStart: Math.min(clamped, target.sourceEnd - MUTE_LIMITS.minSeconds),
          sourceEnd: target.sourceEnd,
        }
      : {
          sourceStart: target.sourceStart,
          sourceEnd: Math.max(clamped, target.sourceStart + MUTE_LIMITS.minSeconds),
        };

  return {
    ...scene,
    mutedRanges: scene.mutedRanges
      .map((r) => (r.id === id ? { ...r, ...next } : r))
      .sort((a, b) => a.sourceStart - b.sourceStart),
  };
}

export function removeMute(scene: VideoScene, id: string): VideoScene {
  if (!scene.mutedRanges.some((r) => r.id === id)) return scene;
  return { ...scene, mutedRanges: scene.mutedRanges.filter((r) => r.id !== id) };
}

/**
 * Flip the whole-video mute. The ranges are kept rather than cleared: turning it
 * back off has to restore what the user drew, not make them draw it again.
 */
export function toggleMuteAll(scene: VideoScene): VideoScene {
  return { ...scene, audioMuted: !scene.audioMuted };
}
