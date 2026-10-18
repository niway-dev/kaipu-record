import type { Display } from "electron";
import type { CaptureMode, OverlayAnswer } from "@shared/types/screenshot-capture";
import type { WindowLister } from "./window-lister";

/** What the user picked on an overlay; shared with the overlay renderer. */
export type { OverlayAnswer };

/** The picking UI a provider may use; main-only, so Electron types are fine. */
export interface OverlayPort {
  /** Show one overlay per display in `ui` mode; resolve with the user's answer. */
  pick(ui: CaptureMode, displays: Display[]): Promise<OverlayAnswer>;
  /**
   * Hide every overlay and resolve once they are off screen: hidden, one tick, and one
   * renderer animation frame (or a short cap). The backend captures only after this
   * resolves, so no overlay ends up in the shot. `pick` never hides or destroys on its own.
   */
  hideAll(): Promise<void>;
  /** Destroy every overlay and end the pick session. Safe to call more than once. */
  destroyAll(): void;
}

/**
 * Where Window mode's list of on-screen windows comes from: the port is defined once, in
 * `window-lister.ts`. The overlay asks once per pick (the first time Window is shown on macOS,
 * as soon as the pick opens on Windows, where PowerShell is slow to start) and renders
 * "Finding windows…" until it answers. A lister that rejects is treated as an empty list,
 * never as a stuck overlay.
 *
 * Injection seam: `CaptureOverlayWindows` takes it as `deps.windowLister`. Production passes
 * `createWindowLister(process.platform)` (`screenshot-ipc.ts`); the default, used by tests,
 * is `NO_WINDOWS_LISTER`, so Window mode shows "No windows on this display".
 */
export type { WindowLister };

/** The placeholder lister: finds nothing. */
export const NO_WINDOWS_LISTER: WindowLister = { list: async () => [] };
