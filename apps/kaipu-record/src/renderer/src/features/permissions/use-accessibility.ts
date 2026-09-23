import { useCallback, useEffect, useState } from "react";
import type { AccessibilityStatus } from "@shared/types";

interface UseAccessibility {
  status: AccessibilityStatus;
  /** Re-read current grant status from the OS (no prompt). */
  check: () => Promise<void>;
  /**
   * User-initiated only: the onboarding Accessibility step and the Settings "Zoom on
   * clicks" row are the only two call sites (plans/video-editor-v2/03 § UI). On macOS
   * this registers the app and shows the system prompt the first time; nothing on the
   * recording path may call it (see click-hook.ts, which only ever checks, never asks).
   */
  request: () => Promise<void>;
}

/**
 * Wraps the `window.electronAPI` accessibility bridge in React state, mirroring
 * `use-permissions.ts`'s shape (status + check + request) for the media permissions.
 * Kept separate because accessibility is a single macOS-only tri-state, not a
 * per-`PermissionKind` grant.
 */
export function useAccessibility(): UseAccessibility {
  const [status, setStatus] = useState<AccessibilityStatus>("not-required");

  const check = useCallback(async () => {
    const next = await window.electronAPI.getAccessibilityStatus();
    setStatus(next);
  }, []);

  const request = useCallback(async () => {
    const next = await window.electronAPI.requestAccessibility();
    setStatus(next);
  }, []);

  useEffect(() => {
    void check();
    // Granting happens in System Settings, outside the app — re-read on focus so the
    // UI reflects a change without requiring the restart-hint copy to be taken literally
    // mid-session (the click hook itself still needs a real restart to pick it up).
    const onFocus = (): void => void check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check]);

  return { status, check, request };
}
