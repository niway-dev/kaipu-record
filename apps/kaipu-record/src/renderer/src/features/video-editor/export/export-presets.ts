/**
 * Export presets per destination (NIW2-218): every number behind "Balanced", "Light",
 * "YouTube 1440p", "YouTube 4K", "Reels · TikTok · Shorts", "Feeds" and "Maximum quality" lives in this one
 * table, so updating a platform limit or a quality tier is a one-line change.
 *
 * WORKER-BUNDLE INVARIANT: pure and DOM-free. The export worker imports it too.
 *
 * Sources (verified 2026-10-08, see the NIW2-218 spec):
 * - YouTube: https://support.google.com/youtube/answer/1722171 (re-checked 2026-10-30 for
 *   NIW2-564) — SDR video at 8 / 12 Mbps @ 1080p, 16 / 24 Mbps @ 1440p and 45 / 68 Mbps @ 2160p
 *   (≤ 30 fps / > 30 fps; the top of each range), AAC-LC with stereo at 384 kbps, moov at the
 *   front ("Fast Start").
 * - GitHub attachments: videos up to 100 MB on paid plans (10 MB on free ones) —
 *   https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
 */

export {
  EXPORT_FRAMINGS,
  EXPORT_PRESET_IDS,
  isExportFraming,
  isExportPresetId,
  isYoutubePreset,
  normalizeExportPresetId,
  YOUTUBE_PRESET_IDS,
  type ExportFraming,
  type ExportPresetId,
  type YoutubePresetId,
} from "@shared/types/export-preset";
import {
  EXPORT_FRAMINGS,
  isYoutubePreset,
  type ExportFraming,
  type ExportPresetId,
  type YoutubePresetId,
} from "@shared/types/export-preset";

/** What fills the canvas around a Fit frame (spec Q2): black, or a blurred copy of the frame. */
export type PaddingFill = "black" | "blur";

/** Decimal megabytes, as GitHub counts them (and Finder shows them). */
export const MB = 1_000_000;

/**
 * Video bitrate for a 1920×1080 (or 1080×1920) frame, per YouTube's recommendation. Vertical
 * and Square scale it by pixel count (`fixedVideoBitrate`).
 */
const BITRATE_1080_LOW_FPS = 8_000_000;
const BITRATE_1080_HIGH_FPS = 12_000_000;
const PIXELS_1080 = 1920 * 1080;

/**
 * Video bits/s of the YouTube canvases, straight from YouTube's SDR upload table (source in
 * the header), at the top of each range: the encode is bitrate-driven, and a screen recording
 * rarely fills a ceiling this high, so the top costs little and keeps fast motion clean.
 * `lowFps` is ≤ 30 fps, `highFps` above (48 and 60 fps recordings).
 */
export const YOUTUBE_VIDEO_BITRATES = {
  "youtube-1440": { lowFps: 16_000_000, highFps: 24_000_000 },
  "youtube-4k": { lowFps: 45_000_000, highFps: 68_000_000 },
} as const satisfies Record<YoutubePresetId, { lowFps: number; highFps: number }>;

/** Video bitrate for a YouTube canvas at the source frame rate. */
export function youtubeVideoBitrate(presetId: YoutubePresetId, fps: number): number {
  const band = YOUTUBE_VIDEO_BITRATES[presetId];
  return fps > 30 ? band.highFps : band.lowFps;
}

/** AAC for every preset but Maximum and YouTube: 128 kbps, source channels (stereo today). */
export const FIXED_AUDIO_BITRATE = 128_000;
/** AAC for the YouTube canvases: YouTube's recommended 384 kbps stereo. */
export const YOUTUBE_AUDIO_BITRATE = 384_000;
/**
 * Lower AAC bitrates to step down through when the encoder refuses a higher one at the
 * source layout (see `audioEncodingCandidates`), ending at the 128 kbps every preset uses.
 */
const AAC_BITRATE_STEPS = [384_000, 256_000, 192_000, FIXED_AUDIO_BITRATE] as const;

/**
 * Seconds between keyframes. mediabunny's default is 2 s, and on screen recordings — mostly
 * static — those keyframes were most of the file (spike 2026-10-13: the same terminal clip at
 * q30 weighed 3.4 MB with a keyframe every 2 s and 1.3 MB with one every 10 s, same quality).
 * These are files people upload or attach, not live streams, so seek granularity is the only
 * cost: a player decodes from the previous keyframe, at most 10 s back.
 */
export const KEY_FRAME_INTERVAL_SEC = 10;
/**
 * YouTube's upload guide asks for a short closed GOP ("GOP of half the frame rate"), and the
 * YouTube presets (1440p and 4K) target a fixed bitrate, so a longer interval would save them
 * nothing: they keep mediabunny's 2 s default.
 */
export const YOUTUBE_KEY_FRAME_INTERVAL_SEC = 2;

/** Pixels the tier rates below were measured at. */
const TIER_REFERENCE_PIXELS = 1920 * 1080;

/**
 * Quality tiers for screen recordings (NIW2-218; encoding settings from the 2026-10-13 spike,
 * owner-validated). A tier is a quality floor, not a size target: its size is whatever the
 * duration makes it, and the sheet says whether that fits GitHub.
 *
 * The spike encoded the owner's real recordings inside Electron's Chromium through WebCodecs
 * (the app's own path) and compared them with ffmpeg libx264:
 * - AVC on the hardware encoder (VideoToolbox) in quantizer mode (constant quality, like x264's
 *   CRF) with a keyframe every 10 s matches x264 `-preset slow -crf 28` at about the same size.
 *   A 78 s 1080p web-app demo at 24 fps: q28 = 8.41 MB, q30 = 6.96 MB, x264 crf28 = 7.89 MB
 *   (video only). The 171 s terminal recording: 18.7 MB at the old 2 Mbps VBR, ~5.5 MB at q30,
 *   with clean small text.
 * - 720p smudges text (keep 1080p), and 15 fps stutters on zooms and animations (24 fps).
 * - Chromium's software H.264 (OpenH264) leaves text unreadable and has no quantizer mode; HEVC
 *   does not play in Chrome; VP9 and AV1 in software lost on size or speed.
 * The owner picked q30 at 24 fps (`full-gen_avc-hw-q30-kfi10-24fps.mp4`) → Balanced.
 *
 * Quantizer mode has no bitrate, so the size estimate comes from a measured rate per minute of
 * video at 1080p, scaled by pixel count — set above the measurements, since screen content
 * varies more than a bitrate-targeted encode would: Balanced measured 5.4 MB/min on the
 * web-app demo and 2.0 MB/min on the terminal recording, and estimates 6 MB/min.
 */
export interface QualityTier {
  /** Short side of the output, at the source aspect, never upscaled. */
  maxShortSide: number;
  maxFps: number;
  /** AVC quantizer (0–51, lower is better), used where the encoder supports quantizer mode. */
  quantizer: number;
  /**
   * Video bits/s at 1920×1080 where quantizer mode is unsupported (the encoder then targets
   * this bitrate, still with a keyframe every 10 s); scaled by pixel count.
   */
  fallbackBitrate: number;
  /** Estimated video bytes per minute at 1920×1080, scaled by pixel count. */
  videoBytesPerMinute: number;
  audioBitrate: number;
  /** Downmix to mono; null keeps the source layout. */
  audioChannels: 1 | null;
}

export const QUALITY_TIERS = {
  balanced: {
    maxShortSide: 1080,
    maxFps: 24,
    quantizer: 30,
    // The old 2 Mbps @ 15 fps tier, scaled toward 24 fps. Not measured in quantizer's place.
    fallbackBitrate: 2_500_000,
    videoBytesPerMinute: 6 * MB,
    audioBitrate: FIXED_AUDIO_BITRATE,
    audioChannels: null,
  },
  light: {
    maxShortSide: 1080,
    maxFps: 24,
    // Interpolated between the measured q32 and q34 (sizes 0.83× and 0.69–0.73× of q30 on the
    // spike's clips); the owner has not watched a q33 file.
    quantizer: 33,
    // The old 1.2 Mbps @ 15 fps tier, scaled toward 24 fps. Not measured in quantizer's place.
    fallbackBitrate: 1_600_000,
    // ~0.78× Balanced, from the same q32/q34 interpolation.
    videoBytesPerMinute: 4.7 * MB,
    audioBitrate: FIXED_AUDIO_BITRATE,
    audioChannels: null,
  },
} as const satisfies Record<"balanced" | "light", QualityTier>;

export type QualityTierId = keyof typeof QUALITY_TIERS;

export function isQualityTier(presetId: ExportPresetId): presetId is QualityTierId {
  return presetId in QUALITY_TIERS;
}

/**
 * What changed in an encode since the sidecars that might match it. "Already exported" only
 * reuses a file encoded the same way: the tiers moved to quantizer encoding at 24 fps on
 * 2026-10-13, so a Balanced or Light file must carry this revision in its fingerprint (the
 * bitrate-tier files, older Balanced files and the old Small-file exports, now read as Light,
 * never match). The YouTube canvases carry one from the start (NIW2-564): the old 1920×1080
 * "youtube" files read as "youtube-1440" (`normalizeExportPresetId`) with a bare fingerprint,
 * and must never pass for a 1440p file. Bump a revision when its numbers change.
 */
export const ENCODE_REVISION: Partial<Record<ExportPresetId, string>> = {
  balanced: "q30-24fps-kfi10",
  light: "q33-24fps-kfi10",
  "youtube-1440": "2560x1440-v1",
  "youtube-4k": "3840x2160-v1",
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
 * whole export, so the worker asks `canEncodeAudio` and takes the first that works. A mono
 * target's fallbacks stay cheap: keeping the source channels at its bitrate first, then 96 and
 * 128 kbps — a few hundred KB a minute at most. (No preset downmixes since the tiers moved to
 * stereo 128 kbps on 2026-10-13; the path stays for a tier that wants it.)
 *
 * A target above 128 kbps (YouTube's 384 kbps) steps down 256 → 192 → 128 kbps at the source
 * layout: AAC encoders cap the bitrate per channel and sample rate, and a lower rate is better
 * than a failed export.
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
  } else {
    for (const fallback of AAC_BITRATE_STEPS) {
      if (fallback < bitrate) candidates.push({ numberOfChannels: channels, bitrate: fallback });
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
  "youtube-1440": {
    id: "youtube-1440",
    canvas: { width: 2560, height: 1440 },
    framings: [],
    defaultFraming: "fit",
    padding: "black",
  },
  "youtube-4k": {
    id: "youtube-4k",
    canvas: { width: 3840, height: 2160 },
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
 * The YouTube row the sheet preselects for a source: 1440p unless fitting the source into
 * 2560×1440 would shrink it (wider than 2560 or taller than 1440 — a Retina or 4K capture),
 * where 4K keeps every source pixel. A 1080p-class source is upscaled either way, and 1440p
 * already gets YouTube's better encode at a third of 4K's size.
 */
export function defaultYoutubePreset(
  source: Pick<ExportSourceInfo, "width" | "height">,
): YoutubePresetId {
  const canvas = PRESETS["youtube-1440"].canvas!;
  return source.width > canvas.width || source.height > canvas.height
    ? "youtube-4k"
    : "youtube-1440";
}

/**
 * GitHub's video attachment limits (source above): 10 MB on Free, 100 MB on Pro / Team /
 * Enterprise. The sheet, Prepare's GitHub destination and the Ready card show both, side by
 * side (owner decision 2026-10-13); the heavy-to-send banner goes by the paid limit, since
 * teams are assumed to be on one. Prepare's list says "under the 10 MB limit" only when the
 * copy fits the free one. None of them blocks an export or lowers the quality to fit — the
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
  /**
   * bits/s, or "high" = mediabunny's 'high' quality level as a bitrate (Maximum keeps the
   * pre-preset export). For a tier, the fallback where quantizer mode is unsupported.
   */
  videoBitrate: number | "high";
  /** AVC quantizer (constant quality); null = bitrate-driven. Only the quality tiers set it. */
  quantizer: number | null;
  /** Seconds between keyframes. */
  keyFrameInterval: number;
  audioBitrate: number | "high";
  /** Downmix to this many channels; null keeps the source layout. */
  audioChannels: 1 | null;
  /** Drop frames above this rate; null keeps the source cadence. */
  maxFps: number | null;
  /** moov at the front, reserved positionally (never 'in-memory', see FR9). */
  fastStart: "reserve" | false;
  /** `maximumPacketCount` per track for the reserve. */
  packetCounts: { video: number; audio: number };
  /** Size estimate in bytes; null when unknown (Maximum: no target behind it). */
  estimateBytes: number | null;
}

/** Round down to an even integer (H.264 needs even dimensions), at least 2. */
export function even(n: number): number {
  return Math.max(2, Math.floor(n) & ~1);
}

/**
 * Video bitrate for Vertical and Square: YouTube's 1080p rule, scaled by pixel count. (The
 * YouTube canvases take their own row of the upload table, `youtubeVideoBitrate`.)
 */
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
      quantizer: null,
      keyFrameInterval: KEY_FRAME_INTERVAL_SEC,
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
    const youtube = isYoutubePreset(presetId);
    const videoBitrate = youtube
      ? youtubeVideoBitrate(presetId, source.fps)
      : fixedVideoBitrate(width, height, source.fps);
    const targetAudioBitrate = youtube ? YOUTUBE_AUDIO_BITRATE : FIXED_AUDIO_BITRATE;
    const audioBitrate = source.hasAudio ? targetAudioBitrate : 0;
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
      quantizer: null,
      keyFrameInterval: youtube ? YOUTUBE_KEY_FRAME_INTERVAL_SEC : KEY_FRAME_INTERVAL_SEC,
      audioBitrate: targetAudioBitrate,
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
 * A quality tier: the source aspect, short side ≤ the tier's (never upscaled), ≤ its fps, its
 * quantizer. Quantizer mode has no bitrate to multiply, so the estimate is the tier's measured
 * rate per minute (scaled by pixel count) plus audio — a "~" figure, set high on purpose.
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
  const size =
    srcShort > tier.maxShortSide
      ? sizeForShortSide(srcW, srcH, tier.maxShortSide)
      : { width: srcW, height: srcH };
  // A smaller frame (or a wider one) gets proportionally fewer (or more) bytes.
  const pixelScale = (size.width * size.height) / TIER_REFERENCE_PIXELS;
  const videoBitrate = Math.round(tier.fallbackBitrate * pixelScale);
  const videoBytes = (tier.videoBytesPerMinute * pixelScale * d) / 60;
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
    quantizer: tier.quantizer,
    keyFrameInterval: KEY_FRAME_INTERVAL_SEC,
    audioBitrate: tier.audioBitrate,
    audioChannels: tier.audioChannels,
    maxFps: tier.maxFps,
    fastStart: "reserve",
    packetCounts,
    estimateBytes: Math.ceil(videoBytes + (audioBitrate * d) / 8 + reserveBytes(packetCounts)),
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
