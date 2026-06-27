import { useCallback, useEffect, useState } from "react";
import type { PermissionKind, PermissionStatus } from "@shared/types";
import { EMPTY_PERMISSION_STATUS } from "./permissions";

interface UsePermissions {
  status: PermissionStatus;
  /** Kinds the user actively requested that came back not-granted (macOS denied). */
  denied: Record<PermissionKind, boolean>;
  /** Re-read current grant status from the OS (no prompt). */
  check: () => Promise<void>;
  /** Prompt for one permission, then refresh status. */
  request: (kind: PermissionKind) => Promise<void>;
  /** Deep-link System Settings for a denied permission. */
  openSettings: (kind: PermissionKind) => Promise<void>;
}

const NONE_DENIED: Record<PermissionKind, boolean> = {
  screen: false,
  microphone: false,
  camera: false,
};

/**
 * Wraps the `window.electronAPI` permission bridge in React state. Tracks both
 * the live grant status and which permissions were requested-but-denied, so the
 * UI can fall back to an "Open System Settings" affordance (macOS won't re-prompt
 * once denied).
 */
export function usePermissions(): UsePermissions {
  const [status, setStatus] = useState<PermissionStatus>(EMPTY_PERMISSION_STATUS);
  const [denied, setDenied] = useState<Record<PermissionKind, boolean>>(NONE_DENIED);

  const check = useCallback(async () => {
    const next = await window.electronAPI.checkPermissions();
    setStatus(next);
  }, []);

  const request = useCallback(async (kind: PermissionKind) => {
    const granted = await window.electronAPI.requestPermission(kind);
    setStatus((prev) => ({ ...prev, [kind]: granted }));
    setDenied((prev) => ({ ...prev, [kind]: !granted }));
  }, []);

  const openSettings = useCallback(async (kind: PermissionKind) => {
    await window.electronAPI.openSystemSettings(kind);
  }, []);

  useEffect(() => {
    void check();
    // Granting happens in System Settings, outside the app. Re-read status when
    // the window regains focus so the UI reflects changes without a restart
    // (mic/camera update live; screen recording may still need an app relaunch).
    const onFocus = (): void => void check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check]);

  return { status, denied, check, request, openSettings };
}
