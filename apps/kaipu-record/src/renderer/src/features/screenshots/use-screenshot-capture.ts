import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

export function useScreenshotCapture(): { capture: () => Promise<void> } {
  const navigate = useNavigate();
  const capture = useCallback(async () => {
    const shot = await window.electronAPI.captureScreenshot();
    if (!shot) return; // cancelled
    navigate("/screenshot-editor", { state: shot });
  }, [navigate]);
  return { capture };
}
