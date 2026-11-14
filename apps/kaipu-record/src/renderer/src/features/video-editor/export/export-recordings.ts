/**
 * Which recording an export clip reads, and where in that file (ADR 0058). The plan keeps
 * every clip range in AXIS seconds; only the decoder wants local seconds, so the translation
 * lives here, next to the plan, and nowhere else on the export path.
 */
import type { SceneSource } from "../scene";
import type { RenderSegment } from "./export-plan";

const inside = (source: SceneSource, t: number): boolean =>
  t >= source.offset && t <= source.offset + source.durationSeconds;

/**
 * The `SceneSource.id` whose axis range holds the clip, or null for the opened recording.
 * The opened recording has no duration here, but every joined range lies past its end, so a
 * range that is in no joined source is the opened one's. A clip with one end inside a joined
 * range and the other outside it is a broken scene and throws; `label` names it.
 */
export function recordingOfClip(
  sources: readonly SceneSource[] | undefined,
  sourceStart: number,
  sourceEnd: number,
  label = "clip",
): string | null {
  for (const source of sources ?? []) {
    const startIn = inside(source, sourceStart);
    const endIn = inside(source, sourceEnd);
    if (startIn && endIn) return source.id;
    if (startIn || endIn) {
      throw new Error(
        `${label} (${sourceStart}-${sourceEnd}) straddles the end of recording ${source.id}`,
      );
    }
  }
  return null;
}

/** Distinct recordings the plan's clips read, in first-use order; a slide reads none. */
export function recordingsUsed(plan: { segments: readonly RenderSegment[] }): Array<string | null> {
  const used: Array<string | null> = [];
  for (const segment of plan.segments) {
    if (segment.kind === "clip" && !used.includes(segment.sourceId)) used.push(segment.sourceId);
  }
  return used;
}

/** The clip's range in its own file's seconds, for the decoder. */
export function localRange(
  segment: { sourceId: string | null; sourceStart: number; sourceEnd: number },
  sources: readonly SceneSource[] | undefined,
): { start: number; end: number } {
  if (segment.sourceId === null) return { start: segment.sourceStart, end: segment.sourceEnd };
  const source = sources?.find((s) => s.id === segment.sourceId);
  if (!source) throw new Error(`no joined recording ${segment.sourceId}`);
  return { start: segment.sourceStart - source.offset, end: segment.sourceEnd - source.offset };
}
