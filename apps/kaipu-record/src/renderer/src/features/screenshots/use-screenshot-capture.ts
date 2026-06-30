import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ImageSource } from "./image-source";

export function useScreenshotCapture(): { capture: () => Promise<void> } {
  const navigate = useNavigate();
  const capture = useCallback(async () => {
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
