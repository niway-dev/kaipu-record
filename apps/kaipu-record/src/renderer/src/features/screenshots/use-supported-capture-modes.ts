import { useEffect, useState } from "react";
import type { CaptureMode } from "@shared/types/screenshot-capture";

/**
 * The capture modes this platform's backend can serve, asked of main once on mount.
 * `null` until the answer arrives, so callers can tell "unknown yet" from "none".
 * A failed ask also resolves to `[]`: every entry point renders disabled and says
 * why, instead of offering a button that would only answer `unsupported`.
 */
export function useSupportedCaptureModes(): CaptureMode[] | null {
  const [modes, setModes] = useState<CaptureMode[] | null>(null);
  useEffect(() => {
    let live = true;
    window.electronAPI
      .screenshotSupportedModes()
      .then((supported) => live && setModes(supported))
      .catch(() => live && setModes([]));
    return () => {
      live = false;
    };
  }, []);
  return modes;
}
