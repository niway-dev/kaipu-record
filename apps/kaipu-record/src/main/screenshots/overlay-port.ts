import type { Display, Rectangle } from "electron";

/** What the user picked on an overlay. */
export type OverlayAnswer =
  | { kind: "rect"; displayId: number; rect: Rectangle /* DIP, display-relative */ }
  | { kind: "display"; displayId: number }
  | { kind: "cancelled" };

/** The picking UI a provider may use; main-only, so Electron types are fine. */
export interface OverlayPort {
  /** Show one overlay per display in `ui` mode; resolve with the user's answer. */
  pick(ui: "area" | "screen" | "frame", displays: Display[]): Promise<OverlayAnswer>;
}
