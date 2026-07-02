import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getRecorderSnapshot } from "@renderer/features/recording/recorder-store";
import { showToast } from "@renderer/ui/toast-store";
import type { ImageSource } from "./image-source";

export function useScreenshotCapture(): { capture: () => Promise<void> } {
  const navigate = useNavigate();
  const capture = useCallback(async () => {
    // A recording — including its countdown/starting phase — must never be
    // interrupted by a screenshot: it would race the native region selector
    // against the recording start, and bringing the window forward afterward
    // would put the app back on screen inside the still-running recording.
    if (getRecorderSnapshot().status !== "idle") {
      showToast({ message: "Termina la grabación antes de tomar una captura." });
      return;
    }
    const shot = await window.electronAPI.captureScreenshot();
    if (!shot) return; // cancelled — main already restored the window if needed
    // A fresh capture is an in-memory blob source; the editor resolves it generically.
    // Title is stamped at capture time (mirrors recordings' "Recording — <date>") so
    // saved shots are told apart by when they were taken, not a generic "Captura".
    const source: ImageSource = {
      kind: "blob",
      bytes: shot.png,
      width: shot.width,
      height: shot.height,
      title: `Screenshot — ${new Date().toLocaleString()}`,
    };
    // Navigate first (synchronous in the router), THEN ask main to bring the app
    // back — so it reappears already on the editor, not the previous page.
    navigate("/screenshot-editor", { state: source });
    window.electronAPI.revealAfterCapture();
  }, [navigate]);
  return { capture };
}
