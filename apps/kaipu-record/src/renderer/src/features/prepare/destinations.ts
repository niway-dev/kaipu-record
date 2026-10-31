/**
 * Prepare (NIW2-578): where a recording is going, and what copy that place needs.
 *
 * The export presets (`export-presets.ts`) say HOW a file is encoded; this module says WHERE
 * it goes, in the order and grouping a beginner looks for it. Destinations are grouped by
 * who compresses the video last:
 *
 * - "send-more": YouTube, Reels · TikTok · Shorts, LinkedIn and feeds compress every upload
 *   again, so the copy is big on purpose — the platform gets more to work with and text stays
 *   sharp after its own encode.
 * - "keep-light": GitHub, Jira, Linear, Slack, Discord and email play the file as it is, so
 *   smaller is better. Email is its own destination (the Export screen's row) over the same
 *   preset as chat, so `destinationOfPreset("balanced")` still answers "chat".
 * - "keep": an archive copy outside Kaipu, full quality.
 *
 * Every number comes from `resolveExportTarget`; here it is only described. Pure: no React,
 * no i18n — the page maps the result to copy.
 */
import {
  defaultYoutubePreset,
  type ExportFraming,
  type ExportPresetId,
  type ExportSourceInfo,
  githubPlans,
  isYoutubePreset,
  PRESETS,
  type ResolvedExportTarget,
  resolveExportTarget,
  type YoutubePresetId,
} from "@renderer/features/video-editor/export/export-presets";
import {
  addsBarsAt169,
  type SizeKind,
  sizeKindOf,
} from "@renderer/features/video-editor/export/export-size";

export const DESTINATION_IDS = [
  "youtube",
  "vertical",
  "square",
  "github",
  "chat",
  "email",
  "archive",
] as const;
export type DestinationId = (typeof DESTINATION_IDS)[number];

export type DestinationGroupId = "send-more" | "keep-light" | "keep";

/** The list, in order: who compresses it again first, then who plays it as-is, then Keep. */
export const DESTINATION_GROUPS: ReadonlyArray<{
  id: DestinationGroupId;
  destinations: readonly DestinationId[];
}> = [
  { id: "send-more", destinations: ["youtube", "vertical", "square"] },
  { id: "keep-light", destinations: ["github", "chat", "email"] },
  { id: "keep", destinations: ["archive"] },
];

/**
 * The preset behind each destination. YouTube is one destination over two presets (1440p,
 * 4K): the resolution is a choice inside it, defaulting to what suits the recording.
 */
const DESTINATION_PRESETS = {
  youtube: ["youtube-1440", "youtube-4k"],
  vertical: ["vertical"],
  square: ["square"],
  github: ["light"],
  chat: ["balanced"],
  // Email shares chat's preset: one file plays inline in a chat and fits an attachment.
  email: ["balanced"],
  archive: ["maximum"],
} as const satisfies Record<DestinationId, readonly ExportPresetId[]>;

export function isDestinationId(value: unknown): value is DestinationId {
  return typeof value === "string" && (DESTINATION_IDS as readonly string[]).includes(value);
}

export function groupOf(destination: DestinationId): DestinationGroupId {
  return DESTINATION_GROUPS.find((g) => g.destinations.includes(destination))!.id;
}

/** The presets a destination can produce (two for YouTube, one for the rest). */
export function presetsOf(destination: DestinationId): readonly ExportPresetId[] {
  return DESTINATION_PRESETS[destination];
}

/**
 * The preset a destination encodes with for this source. For YouTube, `youtube` picks the
 * resolution; without it, 1440p unless that would shrink the recording (`defaultYoutubePreset`).
 */
export function presetForDestination(
  destination: DestinationId,
  source: Pick<ExportSourceInfo, "width" | "height">,
  youtube?: YoutubePresetId,
): ExportPresetId {
  if (destination === "youtube") return youtube ?? defaultYoutubePreset(source);
  return DESTINATION_PRESETS[destination][0];
}

/** Which destination produced a file of `presetId` ("Already prepared"). */
export function destinationOfPreset(presetId: ExportPresetId): DestinationId {
  if (isYoutubePreset(presetId)) return "youtube";
  return DESTINATION_IDS.find((d) =>
    (DESTINATION_PRESETS[d] as readonly string[]).includes(presetId),
  )!;
}

/** Whether the destination offers Fit / Fill (Reels and feeds: a fixed canvas of another shape). */
export function hasFramingChoice(destination: DestinationId): boolean {
  return PRESETS[DESTINATION_PRESETS[destination][0]].framings.length > 0;
}

/**
 * How the copy's size relates to the recording:
 * - "bigger": bigger on purpose — a platform that compresses again gets more to work with;
 * - "lighter": smaller than the recording;
 * - "not-lighter": a keep-light destination whose copy is no smaller (a recording already
 *   encoded tighter than the tier) — said plainly, never blocked;
 * - "same": the archive copy keeps everything;
 * - "unknown": no estimate, or no size for the recording.
 */
export type SizeDirection = "bigger" | "lighter" | "not-lighter" | "same" | "unknown";

/** How the picture changes: its size, and what happens at the edges when the shape differs. */
export interface PictureChange {
  width: number;
  height: number;
  /** Scaled up, scaled down, or kept at the recording's own size. */
  scale: "up" | "down" | "same";
  /**
   * "none": the shape matches. "black-bars" / "blurred-bands": the whole recording shows,
   * padded. "cropped": the frame is filled and the recording's edges are cut off.
   */
  edges: "none" | "black-bars" | "blurred-bands" | "cropped";
}

/** Smoothness: the recording's own frame rate, or capped to `fps`. */
export type SmoothnessChange = { change: "same" } | { change: "capped"; fps: number };

/**
 * Sound: "none" (the recording has none), "same" (archive keeps it as recorded), "studio"
 * (YouTube's recommended high-quality audio), "standard" (clear voice at a smaller size).
 */
export type SoundChange = "none" | "same" | "studio" | "standard";

export interface CopyPlan {
  destination: DestinationId;
  group: DestinationGroupId;
  target: ResolvedExportTarget;
  /** How sure the size is ("about", "up to", or the archive's "full size"). */
  sizeKind: SizeKind;
  /** The estimate in bytes; null for the archive copy (no estimate behind it). */
  estimateBytes: number | null;
  direction: SizeDirection;
  /**
   * GitHub only: true when the estimate fits GitHub's 10 MB free-plan limit, the only case
   * where the page may say "under the 10 MB limit". null for every other destination.
   */
  underGithubFreeLimit: boolean | null;
  picture: PictureChange;
  smoothness: SmoothnessChange;
  sound: SoundChange;
}

export interface PlanCopyInput {
  destination: DestinationId;
  presetId: ExportPresetId;
  /** Fit / Fill for Reels and feeds; ignored elsewhere. */
  framing?: ExportFraming | null;
  source: ExportSourceInfo;
  durationSec: number;
  /** The recording's file size; null when unknown. */
  sourceSizeBytes: number | null;
}

/** A frame-rate difference below this is the same rate (a 23.98 vs 24 fps average). */
const FPS_TOLERANCE = 0.5;
/** A scale factor this close to 1 is no scaling. */
const SCALE_TOLERANCE = 0.01;

/** Everything the Prepare page says about one destination's copy of this recording. */
export function planCopy({
  destination,
  presetId,
  framing = null,
  source,
  durationSec,
  sourceSizeBytes,
}: PlanCopyInput): CopyPlan {
  const target = resolveExportTarget(presetId, source, durationSec, { framing });
  const group = groupOf(destination);
  const sizeKind = sizeKindOf(presetId);
  const estimateBytes = sizeKind === "full" ? null : target.estimateBytes;
  return {
    destination,
    group,
    target,
    sizeKind,
    estimateBytes,
    direction: sizeDirection(group, estimateBytes, sourceSizeBytes),
    underGithubFreeLimit:
      destination === "github" ? estimateBytes !== null && githubPlans(estimateBytes).free : null,
    picture: pictureChange(target, source),
    smoothness:
      target.maxFps !== null && source.fps > target.maxFps + FPS_TOLERANCE
        ? { change: "capped", fps: target.maxFps }
        : { change: "same" },
    sound: !source.hasAudio
      ? "none"
      : presetId === "maximum"
        ? "same"
        : isYoutubePreset(presetId)
          ? "studio"
          : "standard",
  };
}

function sizeDirection(
  group: DestinationGroupId,
  estimateBytes: number | null,
  sourceSizeBytes: number | null,
): SizeDirection {
  if (group === "keep") return "same";
  if (estimateBytes === null || !sourceSizeBytes || sourceSizeBytes <= 0) return "unknown";
  if (estimateBytes < sourceSizeBytes) return "lighter";
  return group === "send-more" ? "bigger" : "not-lighter";
}

function pictureChange(target: ResolvedExportTarget, source: ExportSourceInfo): PictureChange {
  const { width, height } = target;
  if (target.framing === "identity" || source.width <= 0 || source.height <= 0) {
    // The recording's own shape, maybe scaled down (the tiers never upscale).
    const scale = width < source.width - 1 || height < source.height - 1 ? "down" : "same";
    return { width, height, scale, edges: "none" };
  }
  const sx = width / source.width;
  const sy = height / source.height;
  const fill = target.framing === "fill";
  const factor = fill ? Math.max(sx, sy) : Math.min(sx, sy);
  const scale =
    factor > 1 + SCALE_TOLERANCE ? "up" : factor < 1 - SCALE_TOLERANCE ? "down" : "same";
  const sameShape = Math.abs(sx - sy) / Math.max(sx, sy) <= SCALE_TOLERANCE;
  const edges = sameShape
    ? "none"
    : fill
      ? "cropped"
      : target.padding === "blur"
        ? "blurred-bands"
        : "black-bars";
  // A 16:9 canvas over a 16:9 recording never adds bars, whatever the rounding says.
  return {
    width,
    height,
    scale,
    edges: edges === "black-bars" && !addsBarsAt169(source.width, source.height) ? "none" : edges,
  };
}
