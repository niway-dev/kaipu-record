import type { Display } from "electron";
import type { CaptureMode, OverlayAnswer } from "@shared/types/screenshot-capture";

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
