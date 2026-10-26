import type { RecordingSettings } from "@shared/types/ipc";
import type { CaptureMode, RememberedArea } from "@shared/types/screenshot-capture";

/**
 * What the control bar's mode chip says about the take (design "Kaipu Record Modes"): the
 * ratio of an area drawn with one ("16:9"), else the mode ("FRAME", "WINDOW", "SCREEN").
 * The mode is returned so the bar can draw its icon; the caller translates the name.
 */
export function recordingModeChip(
  settings: Pick<RecordingSettings, "selectedSource" | "area">,
  recordingArea: Record<string, RememberedArea> | undefined,
): { mode: CaptureMode; ratio: string | null } {
  if (settings.area) {
    const ratio = recordingArea?.[String(settings.area.displayId)]?.ratio;
    return { mode: "frame", ratio: ratio && ratio !== "free" ? ratio : null };
  }
  if (settings.selectedSource?.type === "window") return { mode: "window", ratio: null };
  return { mode: "screen", ratio: null };
}
