/**
 * Export presets per destination (NIW2-218): every number behind "YouTube 16:9",
 * "Vertical 9:16", "Square 1:1" and "Small file" lives in this one table, so updating a
 * platform limit is a one-line change.
 *
 * WORKER-BUNDLE INVARIANT: pure and DOM-free. The export worker imports it too.
 *
 * Sources (verified 2026-10-08, see the NIW2-218 spec):
 * - YouTube: https://support.google.com/youtube/answer/1722171 — 8 Mbps @ 1080p ≤ 30 fps,
 *   12 Mbps @ 1080p > 30 fps, AAC, moov at the front ("Fast Start").
 * - GitHub free attachments: 10 MB videos —
 *   https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
 * - Discord (no Nitro): 20 MB — https://support.discord.com/hc/en-us/articles/25444343291031
 *   (the 25 MB cap is "chat with margin", spec Q6 default).
 */

export {
  EXPORT_FRAMINGS,
  EXPORT_PRESET_IDS,
  isExportFraming,
  isExportPresetId,
  type ExportFraming,
  type ExportPresetId,
} from "@shared/types/export-preset";
import {
  EXPORT_FRAMINGS,
  type ExportFraming,
  type ExportPresetId,
} from "@shared/types/export-preset";

/** What fills the canvas around a Fit frame (spec Q2): black, or a blurred copy of the frame. */
export type PaddingFill = "black" | "blur";

/** Decimal megabytes, as GitHub and Discord count them. */
export const MB = 1_000_000;

/** Share of the cap the encoder may target: room for container overhead + VBR overshoot. */
export const SIZE_BUDGET_RATIO = 0.92;

/** Video bitrate for a 1920×1080 (or 1080×1920) frame, per YouTube's recommendation. */
const BITRATE_1080_LOW_FPS = 8_000_000;
const BITRATE_1080_HIGH_FPS = 12_000_000;
const PIXELS_1080 = 1920 * 1080;

/** AAC for the fixed presets: 128 kbps, source channels (stereo for every recording today). */
export const FIXED_AUDIO_BITRATE = 128_000;
/** AAC for Small file: mono 64 kbps — speech-quality, half the bits of stereo. */
export const SMALL_AUDIO_BITRATE = 64_000;

/** Upper bound of the moov bytes mediabunny reserves per packet with `fastStart: 'reserve'`. */
export const RESERVE_BYTES_PER_PACKET = 35;
/** Safety margin on predicted packet counts (mediabunny's own recommendation is ~33%). */
export const PACKET_MARGIN = 1.33;
/** AAC frames per packet. */
const AAC_FRAMES_PER_PACKET = 1024;

/**
 * Small-file ladder: short side of the output (at the source aspect) and the lowest
 * video bitrate that still reads well for screen content at that size.
 */
export const SMALL_FILE_LADDER = [
  { shortSide: 1080, floorBps: 1_200_000 },
  { shortSide: 720, floorBps: 600_000 },
  { shortSide: 540, floorBps: 350_000 },
  { shortSide: 480, floorBps: 250_000 },
] as const;

/** fps cap on every Small-file rung below 1080p. */
export const SMALL_FILE_LOW_RUNG_FPS = 30;

interface FixedCanvas {
  width: number;
  height: number;
}

export interface PresetDefinition {
  id: ExportPresetId;
  /** null = the source's own size (Original) or the ladder (Small file). */
  canvas: FixedCanvas | null;
  /** Framings the user may choose; empty = no choice. */
  framings: readonly ExportFraming[];
  defaultFraming: ExportFraming | null;
  /** Padding behind a Fit frame. */
  padding: PaddingFill;
  /** Small file cap in bytes; null for the others. */
  capBytes: number | null;
}

export const PRESETS: Record<ExportPresetId, PresetDefinition> = {
  original: {
    id: "original",
    canvas: null,
    framings: [],
    defaultFraming: null,
    padding: "black",
    capBytes: null,
  },
  youtube: {
    id: "youtube",
    canvas: { width: 1920, height: 1080 },
    framings: [],
    defaultFraming: "fit",
    padding: "black",
    capBytes: null,
  },
  vertical: {
    id: "vertical",
    canvas: { width: 1080, height: 1920 },
    framings: EXPORT_FRAMINGS,
    defaultFraming: "fill",
    padding: "blur",
    capBytes: null,
  },
  square: {
    id: "square",
    canvas: { width: 1080, height: 1080 },
    framings: EXPORT_FRAMINGS,
    defaultFraming: "fit",
    padding: "blur",
    capBytes: null,
  },
  "small-10": {
    id: "small-10",
    canvas: null,
    framings: [],
    defaultFraming: null,
    padding: "black",
    capBytes: 10 * MB,
  },
  "small-25": {
    id: "small-25",
    canvas: null,
    framings: [],
    defaultFraming: null,
    padding: "black",
    capBytes: 25 * MB,
  },
};

export interface ExportSourceInfo {
  width: number;
  height: number;
  /** Average frame rate of the source video track. */
  fps: number;
  /** The export will carry an audio track (source has audio AND the edit doesn't mute it). */
  hasAudio: boolean;
  /** Source audio sample rate; 48000 when unknown. */
  sampleRate?: number;
}

export interface ResolvedExportTarget {
  presetId: ExportPresetId;
  width: number;
  height: number;
  /** "identity": the output IS the composed source frame (Original, Small file). */
  framing: ExportFraming | "identity";
  padding: PaddingFill;
  /** bits/s, or "high" = mediabunny QUALITY_HIGH (Original keeps today's behaviour). */
  videoBitrate: number | "high";
  audioBitrate: number | "high";
  /** Downmix to this many channels; null keeps the source layout. */
  audioChannels: 1 | null;
  /** Drop frames above this rate; null keeps the source cadence. */
  maxFps: number | null;
  /** moov at the front, reserved positionally (never 'in-memory', see FR9). */
  fastStart: "reserve" | false;
  /** `maximumPacketCount` per track for the reserve. */
  packetCounts: { video: number; audio: number };
  /** Upper-bound size estimate in bytes; null when unknown (Original: QUALITY_HIGH). */
  estimateBytes: number | null;
  capBytes: number | null;
  /** false only for a Small-file cap that can't be met even at the lowest rung. */
  achievable: boolean;
  /** Small file: the longest duration that fits the cap at the lowest rung. */
  maxDurationSec: number | null;
}

/** Round down to an even integer (H.264 needs even dimensions), at least 2. */
export function even(n: number): number {
  return Math.max(2, Math.floor(n) & ~1);
}

/** Video bitrate for a fixed canvas: YouTube's 1080p rule, scaled by pixel count. */
export function fixedVideoBitrate(width: number, height: number, fps: number): number {
  const base = fps > 30 ? BITRATE_1080_HIGH_FPS : BITRATE_1080_LOW_FPS;
  return Math.round((base * (width * height)) / PIXELS_1080);
}

/** Output size whose short side is `shortSide`, at the source aspect, even dimensions. */
export function sizeForShortSide(
  srcW: number,
  srcH: number,
  shortSide: number,
): { width: number; height: number } {
  if (srcW >= srcH) {
    return { width: even((srcW * shortSide) / srcH), height: even(shortSide) };
  }
  return { width: even(shortSide), height: even((srcH * shortSide) / srcW) };
}

/**
 * `maximumPacketCount` per track: one packet per video frame at the output rate plus the
 * slide frames, one per 1024 AAC frames, both with the 1.33 margin. The video rate never
 * assumes less than 30 fps — a variable-rate screen recording can burst above its average.
 */
export function packetCountsFor(opts: {
  durationSec: number;
  fps: number;
  maxFps: number | null;
  slideFrames: number;
  hasAudio: boolean;
  sampleRate: number;
}): { video: number; audio: number } {
  const d = Math.max(0, opts.durationSec);
  const fps =
    opts.maxFps !== null
      ? Math.min(opts.maxFps, Math.max(1, opts.fps))
      : Math.max(30, Math.ceil(opts.fps));
  const video = Math.ceil(d * fps * PACKET_MARGIN) + opts.slideFrames + 1;
  const audio = opts.hasAudio
    ? Math.ceil(((d * opts.sampleRate) / AAC_FRAMES_PER_PACKET) * PACKET_MARGIN) + 1
    : 0;
  return { video, audio };
}

/** Bytes the moov reservation takes for these packet counts. */
export function reserveBytes(counts: { video: number; audio: number }): number {
  return (counts.video + counts.audio) * RESERVE_BYTES_PER_PACKET;
}

export interface ResolveOptions {
  /** Fixed-canvas presets only; ignored elsewhere. Defaults to the preset's default. */
  framing?: ExportFraming | null;
  /** Slide frames the plan synthesizes (Σ round(duration × slideFps)). */
  slideFrames?: number;
}

/**
 * Everything the worker needs to produce `presetId` for this source and duration, plus
 * the estimate the sheet shows. Pure math: reads no media.
 */
export function resolveExportTarget(
  presetId: ExportPresetId,
  source: ExportSourceInfo,
  durationSec: number,
  options: ResolveOptions = {},
): ResolvedExportTarget {
  const preset = PRESETS[presetId];
  const sampleRate = source.sampleRate && source.sampleRate > 0 ? source.sampleRate : 48000;
  const slideFrames = options.slideFrames ?? 0;
  const d = Math.max(0, durationSec);
  const srcW = even(source.width);
  const srcH = even(source.height);

  if (presetId === "original") {
    const packetCounts = packetCountsFor({
      durationSec: d,
      fps: source.fps,
      maxFps: null,
      slideFrames,
      hasAudio: source.hasAudio,
      sampleRate,
    });
    return {
      presetId,
      // Exactly today's output size: the source's native pixels, untouched.
      width: source.width,
      height: source.height,
      framing: "identity",
      padding: "black",
      videoBitrate: "high",
      audioBitrate: "high",
      audioChannels: null,
      maxFps: null,
      fastStart: "reserve",
      packetCounts,
      estimateBytes: null,
      capBytes: null,
      achievable: true,
      maxDurationSec: null,
    };
  }

  if (preset.canvas) {
    const framing: ExportFraming =
      preset.framings.length === 0
        ? (preset.defaultFraming ?? "fit")
        : options.framing && preset.framings.includes(options.framing)
          ? options.framing
          : (preset.defaultFraming ?? "fit");
    const { width, height } = preset.canvas;
    const videoBitrate = fixedVideoBitrate(width, height, source.fps);
    const audioBitrate = source.hasAudio ? FIXED_AUDIO_BITRATE : 0;
    const packetCounts = packetCountsFor({
      durationSec: d,
      fps: source.fps,
      maxFps: null,
      slideFrames,
      hasAudio: source.hasAudio,
      sampleRate,
    });
    return {
      presetId,
      width,
      height,
      framing,
      padding: preset.padding,
      videoBitrate,
      audioBitrate: FIXED_AUDIO_BITRATE,
      audioChannels: null,
      maxFps: null,
      fastStart: "reserve",
      packetCounts,
      estimateBytes: Math.ceil(
        ((videoBitrate + audioBitrate) * d) / 8 + reserveBytes(packetCounts),
      ),
      capBytes: null,
      achievable: true,
      maxDurationSec: null,
    };
  }

  return resolveSmallFile(preset, source, srcW, srcH, d, sampleRate, slideFrames);
}

function resolveSmallFile(
  preset: PresetDefinition,
  source: ExportSourceInfo,
  srcW: number,
  srcH: number,
  d: number,
  sampleRate: number,
  slideFrames: number,
): ResolvedExportTarget {
  const cap = preset.capBytes ?? 10 * MB;
  const budget = cap * SIZE_BUDGET_RATIO;
  const audioBps = source.hasAudio ? SMALL_AUDIO_BITRATE : 0;
  const srcShort = Math.min(srcW, srcH);

  // Never above the source's short side. A source smaller than the lowest rung keeps its
  // own size with the lowest rung's floor.
  const lowest = SMALL_FILE_LADDER[SMALL_FILE_LADDER.length - 1];
  const rungs = SMALL_FILE_LADDER.filter((r) => r.shortSide <= srcShort);
  const candidates =
    rungs.length > 0 ? rungs : [{ shortSide: srcShort, floorBps: lowest.floorBps }];

  const evaluate = (rung: { shortSide: number; floorBps: number }) => {
    const maxFps = rung.shortSide < 1080 ? SMALL_FILE_LOW_RUNG_FPS : null;
    const packetCounts = packetCountsFor({
      durationSec: d,
      fps: source.fps,
      maxFps,
      slideFrames,
      hasAudio: source.hasAudio,
      sampleRate,
    });
    // The moov reservation sits inside the cap too.
    const available = budget - reserveBytes(packetCounts);
    const v = d > 0 ? (available * 8 - audioBps * d) / d : Number.POSITIVE_INFINITY;
    return { rung, maxFps, packetCounts, v };
  };

  const evaluated = candidates.map(evaluate);
  const chosen = evaluated.find((e) => e.v >= e.rung.floorBps);
  const pick = chosen ?? evaluated[evaluated.length - 1];
  const size = sizeForShortSide(srcW, srcH, pick.rung.shortSide);
  const fpsForCeiling = pick.maxFps !== null ? Math.min(pick.maxFps, source.fps) : source.fps;
  // Short clips get a huge budget; never exceed what the fixed presets would use at this size.
  const ceiling = fixedVideoBitrate(size.width, size.height, fpsForCeiling);
  const achievable = chosen !== undefined;
  const videoBitrate = achievable
    ? Math.max(pick.rung.floorBps, Math.min(Math.floor(pick.v), ceiling))
    : pick.rung.floorBps;

  const contentBytes = ((videoBitrate + audioBps) * d) / 8 + reserveBytes(pick.packetCounts);
  const estimateBytes = Math.ceil(achievable ? Math.min(cap, contentBytes) : contentBytes);
  // Longest duration that fits at the floor (reservation ignored: it scales with d too,
  // and it's a hint, not a promise).
  const maxDurationSec = Math.floor((budget * 8) / (pick.rung.floorBps + audioBps));

  return {
    presetId: preset.id,
    width: size.width,
    height: size.height,
    framing: "identity",
    padding: "black",
    videoBitrate,
    audioBitrate: SMALL_AUDIO_BITRATE,
    audioChannels: 1,
    maxFps: pick.maxFps,
    fastStart: "reserve",
    packetCounts: pick.packetCounts,
    estimateBytes,
    capBytes: cap,
    achievable,
    maxDurationSec,
  };
}

/** Σ slide frames the plan synthesizes; feeds the video packet count. */
export function slideFrameCount(
  segments: ReadonlyArray<{ kind: string; duration: number }>,
  slideFps: number,
): number {
  return segments
    .filter((s) => s.kind === "slide")
    .reduce((n, s) => n + Math.round(s.duration * slideFps), 0);
}
