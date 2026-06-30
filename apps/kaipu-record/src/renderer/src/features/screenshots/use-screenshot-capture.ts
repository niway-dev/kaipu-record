import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ImageSource } from "./image-source";

export function useScreenshotCapture(): { capture: () => Promise<void> } {
  const navigate = useNavigate();
  const capture = useCallback(async () => {
    const shot = await window.electronAPI.captureScreenshot();
    if (!shot) return; // cancelled — main already restored the window if needed
    // A fresh capture is an in-memory blob source; the editor resolves it generically.
    const source: ImageSource = {
      kind: "blob",
      bytes: shot.png,
      width: shot.width,
      height: shot.height,
    };
    // Navigate first (synchronous in the router), THEN ask main to bring the app
    // back — so it reappears already on the editor, not the previous page.
    navigate("/screenshot-editor", { state: source });
    window.electronAPI.revealAfterCapture();
  }, [navigate]);
  return { capture };
}
