import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ImageSource } from "./image-source";

export function useScreenshotCapture(): { capture: () => Promise<void> } {
  const navigate = useNavigate();
  const capture = useCallback(async () => {
    const shot = await window.electronAPI.captureScreenshot();
    if (!shot) return; // cancelled
    // A fresh capture is an in-memory blob source; the editor resolves it generically.
    const source: ImageSource = {
      kind: "blob",
      bytes: shot.png,
      width: shot.width,
      height: shot.height,
    };
    navigate("/screenshot-editor", { state: source });
  }, [navigate]);
  return { capture };
}
