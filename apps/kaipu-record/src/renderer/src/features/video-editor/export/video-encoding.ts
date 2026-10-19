/**
 * Which rate control and encoder the export uses (NIW2-218). Pure and DOM-free: the export
 * worker probes the platform (`canEncodeVideo`) and hands the answers here.
 *
 * Order of preference:
 * 1. Hardware AVC in quantizer mode (constant quality) — the quality tiers, where supported.
 *    VideoToolbox on macOS supports it; the spike measured it (see `QUALITY_TIERS`).
 * 2. Hardware AVC at the preset's bitrate — every other preset, and a tier's fallback.
 * 3. Whatever the platform offers ("no-preference"), at the bitrate. In practice Chromium's
 *    software H.264 (OpenH264): it has no quantizer mode and leaves small text blurry, but a
 *    file is better than a failed export. The renderer logs it so we learn where it happens.
 *    (A portrait 1080×1920 also lands here on hardware that refuses its H.264 level.)
 */
import type { ResolvedExportTarget } from "./export-presets";

export interface VideoEncoderSupport {
  /** Hardware AVC accepts the tier's quantizer (false when the preset has none). */
  hardwareQuantizer: boolean;
  /** Hardware AVC accepts the preset's bitrate. */
  hardwareBitrate: boolean;
}

export interface VideoEncodingChoice {
  rateControl: "quantizer" | "bitrate";
  /** Set with `rateControl: "quantizer"`. */
  quantizer: number | null;
  /** The bitrate (or Maximum's "high" level); in quantizer mode, mediabunny's fallback. */
  bitrate: number | "high";
  hardwareAcceleration: "prefer-hardware" | "no-preference";
  keyFrameInterval: number;
  /** No hardware encoder took the config: the platform picks, most likely software. */
  softwareFallback: boolean;
  /** A tier asked for a quantizer and did not get it, so its "~" estimate may be off. */
  quantizerUnsupported: boolean;
}

export function chooseVideoEncoding(
  target: Pick<ResolvedExportTarget, "quantizer" | "videoBitrate" | "keyFrameInterval">,
  support: VideoEncoderSupport,
): VideoEncodingChoice {
  const base = {
    bitrate: target.videoBitrate,
    keyFrameInterval: target.keyFrameInterval,
    quantizerUnsupported: target.quantizer !== null && !support.hardwareQuantizer,
  };
  if (target.quantizer !== null && support.hardwareQuantizer) {
    return {
      ...base,
      rateControl: "quantizer",
      quantizer: target.quantizer,
      hardwareAcceleration: "prefer-hardware",
      softwareFallback: false,
    };
  }
  return {
    ...base,
    rateControl: "bitrate",
    quantizer: null,
    hardwareAcceleration: support.hardwareBitrate ? "prefer-hardware" : "no-preference",
    softwareFallback: !support.hardwareBitrate,
  };
}
