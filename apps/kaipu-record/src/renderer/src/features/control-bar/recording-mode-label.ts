import type { RecordingSettings } from "@shared/types/ipc";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import { inferRecordingRatio, recordingCaptureMode } from "@shared/recording-capture";

/**
 * What the control bar's mode chip says about the take (design "Kaipu Record Modes"): the
 * ratio of an area ("16:9"), else the mode ("FRAME", "WINDOW", "SCREEN"). Same rules as the
 * capture metadata and analytics: the mode from `recordingCaptureMode`, the ratio from the
 * area's locked chip or, for an area chosen before ratios, inferred from its size.
 * The mode is returned so the bar can draw its icon; the caller translates the name.
 */
export function recordingModeChip(settings: Pick<RecordingSettings, "selectedSource" | "area">): {
  mode: CaptureMode;
  ratio: string | null;
} {
  const kind = recordingCaptureMode(settings.selectedSource?.id ?? "", Boolean(settings.area));
  if (kind === "window") return { mode: "window", ratio: null };
  if (kind === "screen" || !settings.area) return { mode: "screen", ratio: null };
  const { rect, ratio } = settings.area;
  const chip = ratio ?? inferRecordingRatio(rect.width, rect.height);
  return { mode: "frame", ratio: chip === "free" ? null : chip };
}
