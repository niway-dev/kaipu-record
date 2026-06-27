import { desktopCapturer, ipcMain, shell, systemPreferences } from "electron";
import { IPC_CHANNELS, type PermissionKind, type PermissionStatus } from "@shared/types";

/**
 * Registers the OS media-permission IPC handlers used by the onboarding flow and
 * the Settings page. Mirrors `recording-sources.ts`: thin Electron wiring around
 * `systemPreferences`, with the testable logic kept in the renderer-side pure
 * helper (`features/onboarding/permissions.ts`).
 *
 * Clicking "Grant" should always do something visible. The platform reality:
 *   - macOS shows a native prompt only when status is "not-determined"
 *     (`askForMediaAccess` for mic/camera; a `desktopCapturer` nudge for screen).
 *     Once denied — or for screen recording, which has no prompt API — the only
 *     recourse is to deep-link the relevant System Settings pane.
 *   - Windows does not gate screen capture and has no `askForMediaAccess`; we
 *     deep-link the `ms-settings:` privacy pane for mic/camera.
 *   - Other platforms don't gate capture, so everything reads as granted.
 *
 * So `requestPermission` prompts when it can and otherwise opens System Settings,
 * always returning the resulting (re-read) grant state.
 */

type PanePerKind = Partial<Record<PermissionKind, string>>;

const MAC_PANES: PanePerKind = {
  camera: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
};

const WINDOWS_PANES: PanePerKind = {
  camera: "ms-settings:privacy-webcam",
  microphone: "ms-settings:privacy-microphone",
  // Windows does not gate screen capture, so there is no screen pane.
};

function isMac(): boolean {
  return process.platform === "darwin";
}

function isWindows(): boolean {
  return process.platform === "win32";
}

/** Deep-link the OS privacy pane for `kind`, if one exists on this platform. */
async function openSettingsPane(kind: PermissionKind): Promise<void> {
  const pane = (isMac() ? MAC_PANES : isWindows() ? WINDOWS_PANES : {})[kind];
  if (pane) await shell.openExternal(pane);
}

function checkPermission(kind: PermissionKind): boolean {
  // Screen capture is only gated on macOS; elsewhere treat it as available.
  if (kind === "screen" && !isMac()) return true;
  // `getMediaAccessStatus` covers mic/camera on macOS and Windows.
  if (!isMac() && !isWindows()) return true;
  try {
    return systemPreferences.getMediaAccessStatus(kind) === "granted";
  } catch {
    // Older OS versions or unsupported kinds: don't hard-block the user.
    return !isMac();
  }
}

function checkAllPermissions(): PermissionStatus {
  return {
    screen: checkPermission("screen"),
    microphone: checkPermission("microphone"),
    camera: checkPermission("camera"),
  };
}

async function requestPermission(kind: PermissionKind): Promise<boolean> {
  if (checkPermission(kind)) return true;

  try {
    if (isMac()) {
      const status = systemPreferences.getMediaAccessStatus(kind);

      if (kind === "microphone" || kind === "camera") {
        // The native prompt only appears when the user hasn't decided yet.
        if (status === "not-determined") {
          const granted = await systemPreferences.askForMediaAccess(kind);
          if (granted) return true;
        }
      } else if (status === "not-determined") {
        // Screen recording has no prompt API — nudge it via a 1×1 enumeration.
        await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 1, height: 1 },
        });
        if (checkPermission("screen")) return true;
      }
    }

    // Couldn't prompt (already denied, screen recording, or Windows): send the
    // user to System Settings so they can flip it manually.
    await openSettingsPane(kind);
    return checkPermission(kind);
  } catch {
    return false;
  }
}

export function registerPermissionHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.checkPermissions, async (): Promise<PermissionStatus> => {
    return checkAllPermissions();
  });

  ipcMain.handle(
    IPC_CHANNELS.requestPermission,
    async (_event, kind: PermissionKind): Promise<boolean> => {
      return requestPermission(kind);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.openSystemSettings,
    async (_event, kind: PermissionKind): Promise<void> => {
      await openSettingsPane(kind);
    },
  );
}
