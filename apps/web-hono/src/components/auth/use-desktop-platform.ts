import { useEffect, useState } from "react";

import { detectDesktopOs } from "@/lib/desktop-os";

/**
 * "Mac" or "Windows" for the "Kaipu Record for … is waiting" banner, once the page knows where it
 * runs; null before hydration and on anything else, which gets the banner without a platform.
 */
export function useDesktopPlatform(enabled = true): string | null {
  const [platform, setPlatform] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const os = detectDesktopOs(typeof navigator === "undefined" ? undefined : navigator);
    setPlatform(os === "mac" ? "Mac" : os === "windows" ? "Windows" : null);
  }, [enabled]);
  return platform;
}
