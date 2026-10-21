import { useCallback } from "react";
import { useTranslations } from "@kaipu/i18n";
import { getRecorderSnapshot } from "@renderer/features/recording/recorder-store";
import { useOpenInEditor } from "@renderer/features/editor/open-in-editor";
import { showToast } from "@renderer/ui/toast-store";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import { screenshotTitle } from "@shared/screenshot-title";
import type { ImageSource } from "./image-source";

export function useScreenshotCapture(): { capture: (mode?: CaptureMode) => Promise<void> } {
  const { openCapture, openScreenshot } = useOpenInEditor();
  const t = useTranslations("screenshots");
  const capture = useCallback(
    async (mode: CaptureMode = "frame") => {
      // A recording — including its countdown/starting phase — must never be
      // interrupted by a screenshot: it would race the native region selector
      // against the recording start, and bringing the window forward afterward
      // would put the app back on screen inside the still-running recording.
      if (getRecorderSnapshot().status !== "idle") {
        showToast({ message: t("captureWhileRecording") });
        return;
      }
      const shot = await window.electronAPI.captureScreenshot(mode);
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
