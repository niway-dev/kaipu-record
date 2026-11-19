import type { AppSettings } from "@shared/types/ipc";
import type { FrameMemory } from "./capture-overlay-windows";

/** The slice of the settings store the memory reads and writes; tests pass a fake. */
interface SettingsPort {
  get(): AppSettings;
  update(patch: Partial<AppSettings>): void;
}

/**
 * The capture frame's memory (NIW2-878), kept in the app settings: the display it was last
 * used on, apart for a screenshot and a recording, and the rectangle it had there (the same
 * `screenshotFrame` / `recordingArea` the overlay already reads when it opens, ADR 0030).
 *
 * Main owns the display and the close-time write. Settings are the store, not a new file, so
 * a restart keeps the selection and the overlay's own confirm-time write lands in the same
 * place. `save` is one `update` call (one persist, one broadcast), and none when nothing
 * changed.
 */
export function createFrameMemory(settings: SettingsPort): FrameMemory {
  return {
    lastDisplay: (intent) => {
      if (intent === "instant") return null;
      return settings.get().lastFrameDisplay[intent] ?? null;
    },
    save: ({ intent, displayId, area }) => {
      const current = settings.get();
      const patch: Partial<AppSettings> = {};
      if (displayId !== null && current.lastFrameDisplay[intent] !== displayId) {
        patch.lastFrameDisplay = { ...current.lastFrameDisplay, [intent]: displayId };
      }
      if (area) {
        const key = String(area.displayId);
        if (intent === "record") {
          const next = area.ratio ? { ...area.rect, ratio: area.ratio } : area.rect;
          if (JSON.stringify(current.recordingArea[key]) !== JSON.stringify(next)) {
            patch.recordingArea = { ...current.recordingArea, [key]: next };
          }
        } else if (JSON.stringify(current.screenshotFrame[key]) !== JSON.stringify(area.rect)) {
          patch.screenshotFrame = { ...current.screenshotFrame, [key]: area.rect };
        }
      }
      if (Object.keys(patch).length > 0) settings.update(patch);
    },
  };
}
