import type { Translator } from "@kaipu/i18n";
import type { LocalRecording } from "@shared/types/library-storage";
import { formatSize } from "@renderer/features/library/format";
import { showToast } from "@renderer/ui/toast-store";
import { formatMB } from "../components/export-sheet";
import { type ExportPresetId, PRESETS } from "./export-presets";

/**
 * The toast after an MP4 export lands (spec Q9): a shareable file is usually dragged
 * somewhere right away, so it offers "Show in Finder". Maximum quality, the pre-preset
 * export, stays quiet. Shared by the editor's Export and Share.
 */
export function showExportSavedToast(
  t: Translator<"videoEditor">,
  presetId: ExportPresetId,
  recording: LocalRecording,
): void {
  if (presetId === "maximum") return;
  const cap = PRESETS[presetId].capBytes;
  // FR8 / Q5: the one size-check retry still came out over the cap — keep the file, say
  // so with its real size.
  const overCap = cap !== null && recording.sizeBytes > cap;
  showToast({
    message: overCap
      ? t("smallOverCap", { size: formatMB(recording.sizeBytes), cap: formatMB(cap) })
      : t("exportSaved", { size: formatSize(recording.sizeBytes) }),
    action: {
      label: t("exportShowInFinder"),
      onClick: () => void window.electronAPI.revealLocalRecording(recording.id),
    },
    durationMs: 8000,
  });
}
