/**
 * Pure inspector for a take's webcam track (ADR 0037): the sidecar's `webcam` entry against
 * the two files it describes. Used by `scripts/webcam-track-check.ts`; the expectations live
 * here so they are tested, like `cursor-track-report.ts`.
 */
import type { WebcamTrackMeta } from "./webcam-track";

export interface WebcamTrackMedia {
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export type WebcamFindingLevel = "warn" | "error";

export interface WebcamTrackFinding {
  level: WebcamFindingLevel;
  code: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface WebcamTrackReport {
  findings: WebcamTrackFinding[];
  /** True when no finding is level "error". */
  ok: boolean;
}

/** `|screen − webcam − offset|` past this is worth a look (spec section 2). */
const DURATION_TOLERANCE_MS = 500;
/** ffprobe reports 29.97 for a 30 fps track that dropped a frame or two. */
const FPS_TOLERANCE = 1;

export function inspectWebcamTrack(input: {
  meta: WebcamTrackMeta | null;
  webcamFileExists: boolean;
  screen?: WebcamTrackMedia | null;
  webcam?: WebcamTrackMedia | null;
}): WebcamTrackReport {
  const findings: WebcamTrackFinding[] = [];
  const { meta, screen, webcam } = input;
  if (!meta) {
    findings.push({
      level: "error",
      code: "no-webcam-meta",
      message: "The sidecar has no `webcam` entry: the take reads as one without a webcam.",
    });
  }
  if (!input.webcamFileExists) {
    findings.push({
      level: "error",
      code: "webcam-file-missing",
      message: "No .kaipu/<id>.webcam.mp4 beside the recording.",
    });
  }
  if (!meta) return { findings, ok: false };

  if (meta.offsetQuality !== "exact") {
    findings.push({
      level: "warn",
      code: "offset-estimated",
      message:
        "The start offset is estimated (a first-media timestamp fell back to the renderer clock).",
    });
  }
  if (screen?.durationMs !== undefined && webcam?.durationMs !== undefined) {
    const residualMs =
      Math.round((screen.durationMs - webcam.durationMs - meta.startOffsetMs) * 1000) / 1000;
    if (Math.abs(residualMs) > DURATION_TOLERANCE_MS) {
      findings.push({
        level: "warn",
        code: "duration-mismatch",
        message: `screen − webcam − offset is more than ${DURATION_TOLERANCE_MS} ms (expected when the camera was turned off mid-take).`,
        data: { residualMs },
      });
    }
  }
  if (
    webcam?.width !== undefined &&
    webcam.height !== undefined &&
    (webcam.width !== meta.width || webcam.height !== meta.height)
  ) {
    findings.push({
      level: "warn",
      code: "size-mismatch",
      message: "The webcam file's size differs from the sidecar's.",
      data: { file: [webcam.width, webcam.height], sidecar: [meta.width, meta.height] },
    });
  }
  if (webcam?.fps !== undefined && Math.abs(webcam.fps - meta.fps) > FPS_TOLERANCE) {
    findings.push({
      level: "warn",
      code: "fps-mismatch",
      message: "The webcam file's frame rate differs from the sidecar's.",
      data: { file: webcam.fps, sidecar: meta.fps },
    });
  }
  return { findings, ok: !findings.some((f) => f.level === "error") };
}
