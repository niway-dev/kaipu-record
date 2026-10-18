import type { Display } from "electron";
import type { CaptureMode, ListedWindow, OverlayAnswer } from "@shared/types/screenshot-capture";

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
  /**
   * Push the on-screen window list into the state every overlay renders (Window mode).
   * Ignored when no pick is open.
   */
  setWindows(list: ListedWindow[]): void;
}

/**
 * Where Window mode's list of on-screen windows comes from. The overlay asks once per pick,
 * the first time Window is shown, and renders "Finding windows…" until it answers.
 *
 * Injection seam: `CaptureOverlayWindows` takes it as `deps.windowLister`. Until the OS
 * listers land (macOS JXA, Windows PowerShell; spec task 2) the default is
 * `NO_WINDOWS_LISTER`, so Window mode shows "No windows on this display" instead of hanging.
 * A lister that rejects is treated as an empty list, never as a stuck overlay.
 */
export interface WindowLister {
  list(displays: Display[]): Promise<ListedWindow[]>;
}

/** The placeholder lister: finds nothing. */
export const NO_WINDOWS_LISTER: WindowLister = { list: async () => [] };
