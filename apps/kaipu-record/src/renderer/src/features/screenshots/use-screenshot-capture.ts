import { useCallback } from "react";
import { useTranslations } from "@kaipu/i18n";
import { getRecorderSnapshot } from "@renderer/features/recording/recorder-store";
import { useOpenInEditor } from "@renderer/features/editor/open-in-editor";
import { showToast } from "@renderer/ui/toast-store";
import type { CaptureIntent, CaptureMode } from "@shared/types/screenshot-capture";
import { screenshotTitle } from "@shared/screenshot-title";
import type { ImageSource } from "./image-source";
import { isMaintenanceError } from "@renderer/features/library/vault-errors";

export function useScreenshotCapture(): {
  capture: (mode?: CaptureMode, intent?: CaptureIntent) => Promise<void>;
} {
  const { openCapture, openScreenshot } = useOpenInEditor();
  const t = useTranslations("screenshots");
  const capture = useCallback(
    async (mode: CaptureMode = "frame", intent: CaptureIntent = "capture") => {
      // A recording — including its countdown/starting phase — must never be
      // interrupted by a screenshot: it would race the native region selector
      // against the recording start, and bringing the window forward afterward
      // would put the app back on screen inside the still-running recording.
      if (getRecorderSnapshot().status !== "idle") {
        showToast({ message: t("captureWhileRecording") });
        return;
      }
      // `record` opens the overlay to choose what to record (ADR 0030); main handles that
      // answer itself and replies `cancelled`, so the rest of this flow is screenshot-only.
      let shot;
      try {
        shot = await (intent === "record"
          ? window.electronAPI.captureScreenshot(mode, intent)
          : window.electronAPI.captureScreenshot(mode));
      } catch (error) {
        // Refused before any window hid or any pixel was grabbed (NIW2-561).
        if (!isMaintenanceError(error)) throw error;
        showToast({ message: t("captureRefusedMaintenance") });
        window.electronAPI.revealAfterCapture();
        return;
      }
      if (shot.kind === "cancelled") return; // main already restored the window if needed
      if (shot.kind === "unsupported") {
        showToast({
          message: t(
            shot.platform === "win32" ? "captureUnsupportedWindows" : "captureUnsupported",
          ),
        });
        // Bring the window forward so the toast is visible even from the tray.
        window.electronAPI.revealAfterCapture();
        return;
      }
      // Copy: main already saved and copied it and put the main window back where it was
      // (hidden stays hidden, the page stays the page). No editor, and no reveal: that
      // would force the window on screen.
      if (shot.after === "quiet") return;
      // Navigate first (synchronous in the router), THEN ask main to bring the app
      // back — so it reappears already on the editor, not the previous page.
      if (shot.saved) {
        openScreenshot(shot.saved.assetId);
      } else {
        // The vault write failed: the editor opens the bytes in memory, where Save retries.
        const source: ImageSource = {
          kind: "blob",
          bytes: shot.png,
          width: shot.width,
          height: shot.height,
          title: screenshotTitle(),
        };
        openCapture(source);
      }
      window.electronAPI.revealAfterCapture();
    },
    [openCapture, openScreenshot, t],
  );
  return { capture };
}
