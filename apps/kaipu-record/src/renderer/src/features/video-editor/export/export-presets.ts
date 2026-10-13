/**
 * Export presets per destination (NIW2-218): every number behind "Balanced", "Light",
 * "YouTube", "Reels · TikTok · Shorts", "Feeds" and "Maximum quality" lives in this one
 * table, so updating a platform limit or a quality tier is a one-line change.
 *
 * WORKER-BUNDLE INVARIANT: pure and DOM-free. The export worker imports it too.
 *
 * Sources (verified 2026-10-08, see the NIW2-218 spec):
 * - YouTube: https://support.google.com/youtube/answer/1722171 — 8 Mbps @ 1080p ≤ 30 fps,
 *   12 Mbps @ 1080p > 30 fps, AAC, moov at the front ("Fast Start").
 * - GitHub attachments: videos up to 100 MB on paid plans (10 MB on free ones) —
 *   https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
 */

export {
  EXPORT_FRAMINGS,
  EXPORT_PRESET_IDS,
  isExportFraming,
  isExportPresetId,
  normalizeExportPresetId,
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

/** Decimal megabytes, as GitHub counts them (and Finder shows them). */
export const MB = 1_000_000;

/** Video bitrate for a 1920×1080 (or 1080×1920) frame, per YouTube's recommendation. */
const BITRATE_1080_LOW_FPS = 8_000_000;
const BITRATE_1080_HIGH_FPS = 12_000_000;
const PIXELS_1080 = 1920 * 1080;

/** AAC for the fixed presets and Balanced: 128 kbps, source channels (stereo today). */
export const FIXED_AUDIO_BITRATE = 128_000;
/** AAC for Light: mono 64 kbps — speech-quality, half the bits of stereo. */
export const LIGHT_AUDIO_BITRATE = 64_000;

/**
 * Quality tiers for screen recordings (NIW2-218 quality tiers, owner decision 2026-10-13).
 * They replace the size-capped "Small file" rows: those squeezed a long recording down to
 * 480p at 250 kbps to hit 10 MB, and a 2:51 terminal recording came out unreadable. A tier
 * is a quality floor instead — its size is whatever the duration makes it, and the sheet
 * says whether that fits GitHub.
 *
 * Measured 2026-10-13 with ffmpeg `h264_videotoolbox` (the same macOS hardware encoder the
 * app uses, though not the identical WebCodecs path) on the owner's real 1440p terminal
 * recording — scrolling small mono text — in 20 s clips:
 *
 * | Output                 | Result                     |
 * | ---------------------- | -------------------------- |
 * | 480p · 24 fps · 250k   | blocks, unreadable         |
 * | 720p · 30 fps · 1.2M   | unreadable                 |
 * | 720p · 30 fps · 1.8M   | readable, with ghosting    |
 * | 720p · 15 fps · 800k   | readable but smudged       |
 * | 720p · 15 fps · 1.2M   | clean (~9 MB/min) → Light  |
 * | 1080p · 15 fps · 1.2M  | smudged                    |
 * | 1080p · 15 fps · 2M    | clean (~16 MB/min) → Balanced |
 * | 1080p · 30 fps · 3M    | smudged (the old Balanced) |
 * | 1080p · 30 fps · 4M    | still smudged              |
 *
 * Frame rate matters more than resolution for screen content, and VideoToolbox lands almost
 * exactly on the target bitrate (size ≈ bitrate × duration), so the estimates hold. PENDING:
 * the owner's eye on the in-app WebCodecs path, which these numbers were not measured on.
 *
 * Balanced is the measured "Sharp" tier (1080p · 15 fps · 2 Mbps): the recommended row and a
 * separate Sharp row would encode the same file, so there is one row.
 */
export interface QualityTier {
  /** Short side of the output, at the source aspect, never upscaled. */
  maxShortSide: number;
  maxFps: number;
  /** Video bits/s at `maxShortSide`; a smaller source gets proportionally fewer. */
  videoBitrate: number;
  audioBitrate: number;
  /** Downmix to mono; null keeps the source layout. */
  audioChannels: 1 | null;
}

export const QUALITY_TIERS = {
  balanced: {
    maxShortSide: 1080,
    maxFps: 15,
    videoBitrate: 2_000_000,
    audioBitrate: FIXED_AUDIO_BITRATE,
    audioChannels: null,
  },
  light: {
    maxShortSide: 720,
    maxFps: 15,
    videoBitrate: 1_200_000,
    audioBitrate: LIGHT_AUDIO_BITRATE,
    audioChannels: 1,
  },
} as const satisfies Record<"balanced" | "light", QualityTier>;

export type QualityTierId = keyof typeof QUALITY_TIERS;

export function isQualityTier(presetId: ExportPresetId): presetId is QualityTierId {
  return presetId in QUALITY_TIERS;
}

/**
 * What changed in an encode since the sidecars that might match it. "Already exported" only
 * reuses a file encoded the same way: the tiers changed on 2026-10-13, so a Balanced or Light
 * file must carry this revision in its fingerprint (older Balanced files and the old Small-file
 * exports, now read as Light, never match). Bump a revision when its numbers change.
 */
export const ENCODE_REVISION: Partial<Record<ExportPresetId, string>> = {
  balanced: "15fps-2m",
  light: "15fps-1.2m",
};

/** The fingerprint a file of `presetId` records: its content plus the encode revision. */
export function encodeFingerprint(contentFingerprint: string, presetId: ExportPresetId): string {
  const revision = ENCODE_REVISION[presetId];
  return revision ? `${contentFingerprint}#${revision}` : contentFingerprint;
}

export interface AudioEncoding {
  numberOfChannels: number;
  bitrate: number;
}

/**
 * The AAC configurations to try, best first. Chromium's encoder on macOS refuses some
 * layouts (mono 64 kbps at 44.1 kHz, seen 2026-10-13), and an unsupported config fails the
 * whole export, so the worker asks `canEncodeAudio` and takes the first that works. Light's
 * fallbacks stay cheap: keeping the source channels at 64 kbps first, then 96 and 128 kbps —
 * a few hundred KB a minute at most.
 */
export function audioEncodingCandidates(
  target: Pick<ResolvedExportTarget, "audioBitrate" | "audioChannels">,
  sourceChannels: number,
): AudioEncoding[] {
  const bitrate = target.audioBitrate === "high" ? FIXED_AUDIO_BITRATE : target.audioBitrate;
  const channels = target.audioChannels ?? sourceChannels;
  const candidates: AudioEncoding[] = [{ numberOfChannels: channels, bitrate }];
  if (target.audioChannels !== null) {
    for (const fallback of [bitrate, 96_000, FIXED_AUDIO_BITRATE]) {
      candidates.push({ numberOfChannels: sourceChannels, bitrate: fallback });
    }
  }
  return candidates.filter(
    (c, i) =>
      candidates.findIndex(
        (o) => o.numberOfChannels === c.numberOfChannels && o.bitrate === c.bitrate,
      ) === i,
  );
}

/** Upper bound of the moov bytes mediabunny reserves per packet with `fastStart: 'reserve'`. */
export const RESERVE_BYTES_PER_PACKET = 35;
/** Safety margin on predicted packet counts (mediabunny's own recommendation is ~33%). */
export const PACKET_MARGIN = 1.33;
/** AAC frames per packet. */
const AAC_FRAMES_PER_PACKET = 1024;

interface FixedCanvas {
  width: number;
  height: number;
}

export interface PresetDefinition {
  id: ExportPresetId;
  /** null = the source's own aspect (the quality tiers, Maximum). */
  canvas: FixedCanvas | null;
  /** Framings the user may choose; empty = no choice. */
  framings: readonly ExportFraming[];
  defaultFraming: ExportFraming | null;
  /** Padding behind a Fit frame. */
  padding: PaddingFill;
}

export const PRESETS: Record<ExportPresetId, PresetDefinition> = {
  balanced: { id: "balanced", canvas: null, framings: [], defaultFraming: null, padding: "black" },
  light: { id: "light", canvas: null, framings: [], defaultFraming: null, padding: "black" },
  youtube: {
    id: "youtube",
    canvas: { width: 1920, height: 1080 },
    framings: [],
    defaultFraming: "fit",
    padding: "black",
  },
  vertical: {
    id: "vertical",
    canvas: { width: 1080, height: 1920 },
    framings: EXPORT_FRAMINGS,
    defaultFraming: "fill",
    padding: "blur",
  },
  square: {
    id: "square",
    canvas: { width: 1080, height: 1080 },
    framings: EXPORT_FRAMINGS,
    defaultFraming: "fit",
    padding: "blur",
  },
  maximum: { id: "maximum", canvas: null, framings: [], defaultFraming: null, padding: "black" },
};

/**
 * GitHub's video attachment limits (source above): 10 MB on Free, 100 MB on Pro / Team /
 * Enterprise. The sheet and the Ready card show both, side by side (owner decision
 * 2026-10-13); the banner and the Recording saved card go by the paid limit, since teams are
 * assumed to be on one. None of them blocks an export or lowers the quality to fit — the
 * tier IS the floor. (Free-plan sharing of bigger files will go through a Kaipu cloud link.)
 */
export const GITHUB_FREE_LIMIT_BYTES = 10 * MB;
export const GITHUB_PAID_LIMIT_BYTES = 100 * MB;

export type GithubFit = "fits" | "too-big";

/** Against the paid limit (100 MB). */
export function githubFit(bytes: number): GithubFit {
  return bytes <= GITHUB_PAID_LIMIT_BYTES ? "fits" : "too-big";
}

/** Whether a file of `bytes` attaches on GitHub Free and on the paid plans. */
export function githubPlans(bytes: number): { free: boolean; paid: boolean } {
  return { free: bytes <= GITHUB_FREE_LIMIT_BYTES, paid: bytes <= GITHUB_PAID_LIMIT_BYTES };
}

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
  /** "identity": the output IS the composed source frame, maybe scaled (the tiers, Maximum). */
  framing: ExportFraming | "identity";
  padding: PaddingFill;
  /** bits/s, or "high" = mediabunny QUALITY_HIGH (Maximum keeps the pre-preset export). */
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
  /** Size estimate in bytes; null when unknown (Maximum: QUALITY_HIGH). */
  estimateBytes: number | null;
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

  if (isQualityTier(presetId)) {
    return resolveTier(presetId, source, srcW, srcH, d, sampleRate, slideFrames);
  }

  if (presetId === "maximum") {
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
    };
  }

  // Every preset is a tier, Maximum or a fixed canvas.
  throw new Error(`export preset without a resolver: ${presetId}`);
}

/**
 * A quality tier: the source aspect, short side ≤ the tier's (never upscaled), ≤ its fps,
 * its bitrate. Size ≈ (video + audio) × duration — VideoToolbox lands on target (measured).
 */
function resolveTier(
  presetId: QualityTierId,
  source: ExportSourceInfo,
  srcW: number,
  srcH: number,
  d: number,
  sampleRate: number,
  slideFrames: number,
): ResolvedExportTarget {
  const tier: QualityTier = QUALITY_TIERS[presetId];
  const srcShort = Math.min(srcW, srcH);
  const shortSide = Math.min(srcShort, tier.maxShortSide);
  const size =
    srcShort > tier.maxShortSide
      ? sizeForShortSide(srcW, srcH, tier.maxShortSide)
      : { width: srcW, height: srcH };
  // A source below the tier's size gets proportionally fewer bits for its fewer pixels.
  const videoBitrate = Math.round(
    tier.videoBitrate * Math.min(1, (shortSide / tier.maxShortSide) ** 2),
  );
  const audioBitrate = source.hasAudio ? tier.audioBitrate : 0;
  const packetCounts = packetCountsFor({
    durationSec: d,
    fps: source.fps,
    maxFps: tier.maxFps,
    slideFrames,
    hasAudio: source.hasAudio,
    sampleRate,
  });
  return {
    presetId,
    width: size.width,
    height: size.height,
    framing: "identity",
    padding: "black",
    videoBitrate,
    audioBitrate: tier.audioBitrate,
    audioChannels: tier.audioChannels,
    maxFps: tier.maxFps,
    fastStart: "reserve",
    packetCounts,
    estimateBytes: Math.ceil(((videoBitrate + audioBitrate) * d) / 8 + reserveBytes(packetCounts)),
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
